// @vitest-environment node
import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { build } from 'esbuild'
import { chromium, type Browser } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { assembleMeasuredHtml, type HtmlDesignCapture } from '../../src/core/contentApply/assembly/htmlAssembly'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { ContentApplyService } from '../../src/main/workbench/contentApply/applyService'
import type { HtmlDesignMeasurementRequest } from '../../src/main/workbench/contentApply/measurement/ElectronHtmlDesignMeasurement'
import { prepareMeasurementDocument, retainedMeasurementScopeHtml } from '../../src/main/workbench/contentApply/measurement/prepareMeasurementDocument'
import type { ComponentInstance, JsonObject } from '../../src/shared/contracts/component-platform'
import type { DocumentPersistence } from '../../src/shared/workbench/document'

let browser: Browser, captureBundle: string
beforeAll(async () => {
  const bundle = await build({ stdin: { contents: `export {captureHtmlDesignViewport} from './src/main/workbench/contentApply/measurement/browserCapture';export {cssUsesViewport} from './src/components/web/measuredFragmentBox';`, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'FirstWriteCapture', target: 'es2022' })
  captureBundle = bundle.outputFiles[0]!.text
  browser = await chromium.launch({ headless: true })
})
afterAll(async () => { await browser?.close() })

async function captureHtml(request: HtmlDesignMeasurementRequest) {
  const prepared = prepareMeasurementDocument(request)
  const page = await browser.newPage({ viewport: request.viewport })
  try {
    await page.setContent('<!doctype html><body></body>')
    await page.addScriptTag({ content: captureBundle })
    await page.setContent(prepared.html)
    const sourceRoots = await page.evaluate(() => [...document.body.firstElementChild!.children].map(element => {
      const box = element.getBoundingClientRect()
      return { tag: element.localName, text: element.textContent ?? '', x: box.x, y: box.y, width: box.width, height: box.height }
    }))
    const sourceTopColor = await page.evaluate(() => getComputedStyle(document.elementFromPoint(50, 50)!).backgroundColor)
    const capture = await page.evaluate(() => {
      const api = (window as any).FirstWriteCapture
      return api.captureHtmlDesignViewport(200, api.cssUsesViewport)
    }) as HtmlDesignCapture
    const source = { html: request.html, ...(request.themeCss === undefined ? {} : { themeCss: request.themeCss }) }
    for (const element of capture.elements) {
      const original = prepared.originalElements.get(element.sourcePath.join('/'))
      if (original) { element.attributes = original.attributes; element.sourceHtml = original.sourceHtml }
    }
    for (const scope of capture.sourceScopes ?? []) scope.html = retainedMeasurementScopeHtml(source, capture.elements[scope.index]!.sourcePath)
    return { capture, sourceRoots, sourceTopColor, assembly: assembleMeasuredHtml(capture, source, request.framing ?? 'content') }
  } finally { await page.close() }
}

const data = (instance: ComponentInstance) => instance.data as JsonObject
const textOf = (instance: ComponentInstance) => {
  const content = data(instance).content as { inlines: { type: string; text?: string }[] } | undefined
  return content?.inlines.map(value => value.text ?? '').join('')
}
const compact = (value: string) => value.replace(/\s/g, '')

it('assembles the frozen first real author write directly into page paint and independent editable content', async () => {
  // Exact tool 17 / project.apply / operations[0].content from the one authorized author run.
  // This checked-in source is independent of the ignored author output and of its later manual reconstruction.
  const html = await readFile('tests/fixtures/backgroundFirstWrite20261017.html', 'utf8')
  const project = createBlankCourseProjectV10('Frozen first author write')
  const driver = new CourseV10Driver()
  let saved: Uint8Array | undefined
  const persistence: DocumentPersistence = { async append() {}, async save(input) {
    if (input.binding.kind !== 'file') throw new Error('Expected file save')
    saved = Uint8Array.from(input.bytes)
    return { ...input.binding, version: `revision-${input.revision}` }
  } }
  const registryOptions = { drivers: [driver], createId: randomUUID, bindingKey: (binding: { path: string }) => binding.path, persistence }
  let registry = new DocumentRegistry(registryOptions)
  let session = await registry.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'first-write.glx')
  const current = () => {
    const model = session.read().model
    if (model.kind !== 'course-v10') throw new Error('Expected V10')
    return model.project
  }
  let observed: Awaited<ReturnType<typeof captureHtml>> | undefined, measurements = 0
  const service = new ContentApplyService({ session: { project: current, dispatch: command => {
    const snapshot = session.read()
    return session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision,
      operationId: randomUUID(), actor: 'agent', mutation: { type: 'command', command } })
  } }, measure: async request => { measurements++; observed = await captureHtml(request); return observed.assembly },
  compilation: { async compile() { throw new Error('The frozen static content needs no source compilation') } } })
  const result = await service.apply({ intent: 'insert', target: { kind: 'container', container: { kind: 'surface', surfaceId: componentSurfaces(project)[0]!.id } }, source: { kind: 'html', html } })
  expect(result).toMatchObject({ commit: 'committed', usability: 'usable' })
  expect(measurements).toBe(1)
  expect(observed!.capture.sourceScopes).toEqual([])
  expect(session.read()).toMatchObject({ revision: 1, undoDepth: 1 })
  const first = current(), surface = componentSurfaces(first)[0]!, roots = surface.childIds.map(id => first.instances[id]!)
  expect(surface.background).toEqual({ mode: 'own', color: 'rgb(243, 246, 240)', assetId: null })
  expect(roots).toHaveLength(8)
  expect(Object.values(first.instances).some(instance => instance.frame?.width === 1280 && instance.frame.height === 720)).toBe(false)
  for (const [index, root] of roots.entries()) {
    const original = observed!.sourceRoots[index]!, frame = root.frame!
    // Canonical frames keep millipixel precision, below Chromium's fractional layout units.
    expect(frame.width).toBeCloseTo(original.width, 2)
    expect(frame.height).toBeCloseTo(original.height, 2)
    expect(frame.transform).toEqual([1, 0, 0, 1, original.x, original.y])
    if (root.definitionId === 'guoling.text') expect(compact(textOf(root)!)).toBe(compact(original.text))
  }
  expect(roots.filter(instance => instance.definitionId === 'guoling.text')).toHaveLength(6)
  expect(roots[3]!.definitionId).toBe('guoling.web')
  expect(data(roots[3]!).html).toContain('今天的任务：用一个小模型')
  const diagram = roots[5]!
  expect(diagram.definitionId).toBe('guoling.group')
  expect(diagram.frame).toEqual({ width: 565, height: 455, transform: [1, 0, 0, 1, 665, 100] })
  const parts = diagram.childIds!.map(id => first.instances[id]!)
  expect(parts.some(instance => instance.definitionId === 'guoling.shape')).toBe(true)
  const retainedSvg = parts.filter(instance => instance.definitionId === 'guoling.web').map(instance => data(instance).html as string).join('\n')
  for (const label of ['教学楼', '硬化小广场 · 水往外流', '土壤 · 水向下渗', '校园平面示意 / 不是积水深度预测']) expect(retainedSvg).toContain(label)
  expect(retainedSvg).toContain('<svg')
  expect(retainedSvg).toContain('stroke-linecap="round"')
  expect(first.assets).toEqual({})

  const binding = { kind: 'file' as const, path: 'D:/frozen-first-write-test.glx', version: null, bindingVersion: 0 }
  await registry.save(session.documentId, binding)
  expect(saved).toBeDefined()
  registry = new DocumentRegistry(registryOptions)
  session = await registry.open(binding, async () => driver.load(saved!))
  expect(componentSurfaces(current())).toEqual(componentSurfaces(first))
  expect(current().instances).toEqual(first.instances)
}, 20000)

it('still retains a genuine HTML group whose descendant paint interleaves with an outside sibling', async () => {
  const html = '<div style="position:relative;width:1280px;height:720px"><section style="position:relative;width:200px;height:200px"><div style="position:absolute;left:0;top:0;width:180px;height:180px;background:red;z-index:2"></div></section><div style="position:absolute;left:20px;top:20px;width:180px;height:180px;background:blue;z-index:1"></div></div>'
  const observed = await captureHtml({ html, viewport: { width: 1280, height: 720 } })
  expect(observed.capture.sourceScopes).toEqual(expect.arrayContaining([expect.objectContaining({ reason: expect.stringContaining('paint-order') })]))
  expect(observed.assembly.root.retainedSource?.html).toContain('background:red;z-index:2')
  expect(observed.assembly.root.retainedSource?.html).toContain('background:blue;z-index:1')
})

it('retains atomic HTML Web when its positioned descendant paints above an outside sibling', async () => {
  const html = '<div style="position:relative;width:1280px;height:720px"><div style="position:relative;width:200px;height:200px">Atomic web text<div style="position:absolute;left:0;top:0;width:180px;height:180px;background:red;z-index:2"></div></div><div style="position:absolute;left:20px;top:20px;width:180px;height:180px;background:blue;z-index:1"></div></div>'
  const observed = await captureHtml({ html, viewport: { width: 1280, height: 720 } })
  expect(observed.sourceTopColor).toBe('rgb(255, 0, 0)')
  expect(observed.capture.sourceScopes).toEqual(expect.arrayContaining([expect.objectContaining({ reason: expect.stringContaining('positioned-paint-order') })]))
  expect(observed.assembly.root.retainedSource?.html).toContain('Atomic web text')
  expect(observed.assembly.root.retainedSource?.html).toContain('background:red;z-index:2')
  expect(observed.assembly.root.retainedSource?.html).toContain('background:blue;z-index:1')
})

it('assembles the frozen Luna cover into formal page paint and independently owned content', async () => {
  // Exact slide1-cover.html from the completed gpt-6-luna/max author run.
  const html = await readFile('tests/fixtures/lunaCoverPaintBoundary20261017.html', 'utf8')
  const project = createBlankCourseProjectV10('Frozen Luna cover')
  const registry = new DocumentRegistry({ drivers: [new CourseV10Driver()], createId: randomUUID,
    bindingKey: binding => binding.path, persistence: { async append() {}, async save() { throw new Error('Assembly ownership needs no disk save') } } })
  const session = await registry.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'luna-cover.glx')
  const current = () => {
    const model = session.read().model
    if (model.kind !== 'course-v10') throw new Error('Expected V10')
    return model.project
  }
  let observed: Awaited<ReturnType<typeof captureHtml>> | undefined
  const service = new ContentApplyService({ session: { project: current, dispatch: command => {
    const snapshot = session.read()
    return session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision,
      operationId: randomUUID(), actor: 'agent', mutation: { type: 'command', command } })
  } }, measure: async request => { observed = await captureHtml(request); return observed.assembly },
    compilation: { async compile() { throw new Error('This static cover needs no Source compilation') } } })
  const result = await service.apply({ intent: 'insert', target: { kind: 'container', container: { kind: 'surface', surfaceId: componentSurfaces(project)[0]!.id } }, source: { kind: 'html', html } })
  expect(result).toMatchObject({ commit: 'committed', usability: 'usable' })
  expect(observed!.capture.sourceScopes).toEqual([])
  const assembled = current(), instances = Object.values(assembled.instances), surface = componentSurfaces(assembled)[0]!
  expect(surface.background?.paint?.layers[0]?.style['background-image']).toContain('radial-gradient(')
  const heading = instances.find(instance => compact(textOf(instance) ?? '') === '一场雨，校园为何会积水？')
  expect(heading?.definitionId).toBe('guoling.text')
  expect(instances.some(instance => textOf(instance)?.includes('故事场景为教学设想'))).toBe(true)
  expect(instances.some(instance => instance.frame?.width === 1280 && instance.frame.height === 720)).toBe(false)
  const localSvg = instances.filter(instance => instance.definitionId === 'guoling.web').map(instance => data(instance).html).join('\n')
  expect(instances.some(instance => instance.definitionId === 'guoling.shape' && Number(instance.style?.opacity) === .9)).toBe(true)
  expect(localSvg.includes('linearGradient')).toBe(true)
  if (process.env.GUOLING_BACKGROUND_EVIDENCE) {
    const directory = process.env.GUOLING_BACKGROUND_EVIDENCE
    await mkdir(directory, { recursive: true })
    await writeFile(`${directory}/luna-cover-project.json`, JSON.stringify(assembled, null, 2))
    await writeFile(`${directory}/luna-cover-facts.json`, JSON.stringify({ commit: result.commit, usability: result.usability,
      sourceScopes: observed!.capture.sourceScopes, background: surface.background, rootCount: surface.childIds.length,
      instanceCount: instances.length, nativeTextCount: instances.filter(instance => instance.definitionId === 'guoling.text').length,
      nativeShapeCount: instances.filter(instance => instance.definitionId === 'guoling.shape').length,
      fullPageInstances: instances.filter(instance => instance.frame?.width === 1280 && instance.frame.height === 720).length,
      heading: { definitionId: heading?.definitionId, text: heading ? textOf(heading) : null, frame: heading?.frame } }, null, 2))
  }
})

it('keeps descendant compositing inside its viewport without absorbing the independent title or page paint', async () => {
  const html = '<main style="width:1280px;height:720px;background:beige"><h1>Independent title</h1><figure><svg width="200" height="200" viewBox="0 0 200 200" aria-label="Local compositing"><defs><filter id="local-filter"><feGaussianBlur stdDeviation="1"/></filter></defs><g style="opacity:.8;transform:translate(1px,2px);filter:url(#local-filter)"><circle cx="80" cy="80" r="50" fill="red"/></g></svg></figure></main>'
  const observed = await captureHtml({ html, viewport: { width: 1280, height: 720 } })
  expect(observed.assembly.root.kind).toBe('group')
  expect(observed.capture.sourceScopes).toHaveLength(1)
  const scope = observed.capture.sourceScopes![0]!
  expect(observed.capture.elements[scope.index]?.tagName).toBe('g')
  expect(scope.reason).toContain('group-compositing')
  expect(scope.html).toContain('local-filter')
  expect(scope.html).not.toContain('Independent title')
  const objects = [observed.assembly.root]
  for (let index = 0; index < objects.length; index++) objects.push(...objects[index]!.children)
  const localSvg = objects.find(object => object.kind === 'svg')
  expect(JSON.stringify(localSvg?.content).includes('feGaussianBlur')).toBe(true)
})

it.each(['opacity:.8', 'transform:translate(1px,2px)'])('keeps the viewport own %s local when it has no outside paint interleaving', async effect => {
  const html = `<main style="width:1280px;height:720px;background:beige"><h1>Independent title</h1><figure><svg width="200" height="200" viewBox="0 0 200 200" style="${effect}"><g><circle cx="80" cy="80" r="50" fill="red"/></g></svg></figure></main>`
  const observed = await captureHtml({ html, viewport: { width: 1280, height: 720 } })
  expect(observed.assembly.root.kind).toBe('group')
  expect(observed.capture.sourceScopes?.some(scope => scope.index === observed.capture.body)).toBe(false)
  expect(observed.assembly.root.style['background-color']).toBe('rgba(0, 0, 0, 0)')
  const main = observed.assembly.root.children[0]!
  expect(main.style['background-color']).toBe('rgb(245, 245, 220)')
  expect(main.children.some(object => object.kind === 'text')).toBe(true)
})

it('keeps a viewport context with the HTML ancestor when its paint really interleaves outside that ancestor', async () => {
  const html = '<main style="width:1280px;height:720px;background:beige"><figure style="margin:0"><svg width="200" height="200" style="position:relative;z-index:2;transform:translate(1px,2px)"><circle cx="80" cy="80" r="50" fill="red"/></svg></figure><div style="width:200px;height:200px;margin-top:-180px;background:blue">Outside paint</div></main>'
  const observed = await captureHtml({ html, viewport: { width: 1280, height: 720 } })
  expect(observed.assembly.root.retainedSource?.html).toBe(html)
  expect(observed.capture.sourceScopes).toEqual(expect.arrayContaining([expect.objectContaining({ index: observed.capture.body, reason: 'ancestor-paint-order' })]))
})

it('keeps real SVG backdrop blending with the outside HTML paint it consumes', async () => {
  const html = '<main style="width:1280px;height:720px;background:beige"><h1>Backdrop title</h1><svg width="200" height="200"><g style="mix-blend-mode:multiply"><circle cx="80" cy="80" r="50" fill="red"/></g></svg></main>'
  const observed = await captureHtml({ html, viewport: { width: 1280, height: 720 } })
  expect(observed.assembly.root.retainedSource?.html).toBe(html)
  expect(observed.capture.sourceScopes).toEqual(expect.arrayContaining([expect.objectContaining({ index: observed.capture.body, reason: 'shared-compositing' })]))
})

it('keeps a shared SVG filter and its consuming paint in the same source document', async () => {
  const html = '<main style="width:1280px;height:720px"><h1>Independent title</h1><figure><svg width="200" height="200" viewBox="0 0 200 200" aria-label="Shared filter diagram"><circle cx="80" cy="80" r="50" fill="red" filter="url(#shared-filter)"/></svg></figure></main><svg width="0" height="0"><defs><filter id="shared-filter"><feColorMatrix type="saturate" values="0"/></filter></defs></svg>'
  const observed = await captureHtml({ html, viewport: { width: 1280, height: 720 } })
  expect(observed.assembly.root.retainedSource?.html).toBe(html)
  expect(observed.capture.sourceScopes).toEqual(expect.arrayContaining([expect.objectContaining({ index: observed.capture.body, reason: 'fragment-reference' })]))
})
