// @vitest-environment node
import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
import { testContainerInstance } from '../helpers/glxWorkFixture'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { build } from 'esbuild'
import { chromium, type Browser } from 'playwright'
import sharp from 'sharp'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { assembleMeasuredHtml, type HtmlDesignCapture } from '../../src/core/contentApply/assembly/htmlAssembly'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { surfaceSettingsEdits } from '../../src/core/course/courseSemanticEdits'
import { coursePresentationEdits } from '../../src/core/tools/coursePresentationEdits'
import { ContentApplyService } from '../../src/main/workbench/contentApply/applyService'
import type { HtmlDesignMeasurementRequest } from '../../src/main/workbench/contentApply/measurement/ElectronHtmlDesignMeasurement'
import { prepareMeasurementDocument, retainedMeasurementScopeHtml } from '../../src/main/workbench/contentApply/measurement/prepareMeasurementDocument'
import { buildPublishedCourseV3 } from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import { componentBackgroundAssetIds } from '../../src/shared/componentBackgroundPaint'
import { resolveComponentBackground, type ComponentEdit } from '../../src/shared/contracts/component-platform'
import type { PublishedCourseV3 } from '../../src/shared/contracts/component-platform/published'
import type { DocumentPersistence } from '../../src/shared/workbench/document'

const fixture = 'tests/fixtures/backgroundComplexPaint20261017'
const viewport = { width: 640, height: 360 }
const points = [[10, 10], [630, 350], [320, 250]] as const
let browser: Browser, bundle: string, captureBundle: string
beforeAll(async () => {
  const built = await build({ stdin: { contents: `export {captureHtmlDesignViewport} from './src/main/workbench/contentApply/measurement/browserCapture';export {cssUsesViewport} from './src/components/web/measuredFragmentBox';export {compileCoursePlayback} from './src/core/publish/componentPlatform/compileCoursePlayback';export {renderCompiledBuiltin} from './src/renderer/export/componentPlatform/renderCompiledBuiltin';export {mountCompiledCourse} from './src/player/componentPlatform/compiledPlayer';`, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'ComplexPaint', target: 'es2022' })
  bundle = built.outputFiles[0]!.text
  const capture = await build({ stdin: { contents: `export {captureHtmlDesignViewport} from './src/main/workbench/contentApply/measurement/browserCapture';export {cssUsesViewport} from './src/components/web/measuredFragmentBox';`, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'ComplexPaint', target: 'es2022' })
  captureBundle = capture.outputFiles[0]!.text
  browser = await chromium.launch({ headless: true })
})
afterAll(async () => { await browser?.close() })

async function measured(request: HtmlDesignMeasurementRequest, screenshot: boolean) {
  const prepared = prepareMeasurementDocument(request), page = await browser.newPage({ viewport: request.viewport })
  try {
    await page.setContent('<!doctype html><body></body>')
    await page.addScriptTag({ content: captureBundle })
    await page.setContent(prepared.html)
    const capture = await page.evaluate(() => { const api = (window as any).ComplexPaint; return api.captureHtmlDesignViewport(200, api.cssUsesViewport) }) as HtmlDesignCapture
    const originalPixels = screenshot ? await page.screenshot() : undefined
    const source = { html: request.html, ...(request.themeCss === undefined ? {} : { themeCss: request.themeCss }) }
    const references = Object.entries(request.resourceUrls ?? {}).map(([reference, url]) => [url, reference] as const)
    const restore = (value: string) => references.reduce((text, [url, reference]) => text.split(url).join(reference), value)
    const restoreStyle = (style: Record<string, string> | undefined) => { if (style) for (const [name, value] of Object.entries(style)) style[name] = restore(value) }
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
    return { capture, originalPixels, assembly: assembleMeasuredHtml(capture, source, request.framing ?? 'content') }
  } finally { await page.close() }
}

async function authoring(screenshot = false) {
  const project = createBlankCourseProjectV10('Complex background paint'); testContainerInstance(project, 0).container.designSize = viewport
  const driver = new CourseV10Driver()
  let saved: Uint8Array | undefined, observation: Awaited<ReturnType<typeof measured>> | undefined
  const persistence: DocumentPersistence = { async append() {}, async save(input) {
    if (input.binding.kind !== 'file') throw new Error('Expected file save')
    saved = Uint8Array.from(input.bytes); return { ...input.binding, version: `revision-${input.revision}` }
  } }
  const registryOptions = { drivers: [driver], createId: randomUUID, bindingKey: (binding: { path: string }) => binding.path, persistence }
  let registry = new DocumentRegistry(registryOptions)
  let session = await registry.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'complex.glx')
  const current = () => { const model = session.read().model; if (model.kind !== 'course-v10') throw new Error('Expected V10'); return model.project }
  const service = new ContentApplyService({ session: { project: current, resources: () => session.read().model.resources, dispatch: command => {
    const snapshot = session.read(); return session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision,
      operationId: randomUUID(), actor: 'agent', mutation: { type: 'command', command } })
  } }, measure: async request => { observation = await measured(request, screenshot); return observation.assembly },
    compilation: { async compile() { throw new Error('Ordinary measured content requires no source compilation') } } })
  return { current, service, resources: () => session.read().model.resources, observation: () => observation!,
    apply: (html: string, siblingFiles?: ReadonlyMap<string, Uint8Array>) => service.apply({ intent: 'insert', target: { kind: 'container', container: { kind: 'surface', surfaceId: componentSurfaces(current())[0]!.id } }, source: { kind: 'html', html, siblingFiles } }),
    canonical: (edits: ComponentEdit[]) => service.apply({ intent: 'canonical', edits }),
    async reopen() {
      const binding = { kind: 'file' as const, path: 'D:/complex-paint-test.glx', version: null, bindingVersion: 0 }
      await registry.save(session.documentId, binding)
      if (!saved) throw new Error('Save did not serialize the model')
      registry = new DocumentRegistry(registryOptions); session = await registry.open(binding, async () => driver.load(saved!))
      return current()
    } }
}

async function pixels(bytes: Uint8Array) {
  const decoded = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return points.map(([x, y]) => [...decoded.data.subarray((y * decoded.info.width + x) * 4, (y * decoded.info.width + x) * 4 + 3)])
}
function expectPixels(actual: number[][], expected: number[][]) {
  actual.forEach((pixel, index) => pixel.forEach((value, channel) => expect(Math.abs(value - expected[index]![channel]!)).toBeLessThanOrEqual(1)))
}

it('carries measured multi-image/gradient page paint through formal save and compiled Player state changes', async () => {
  const html = await readFile(`${fixture}/index.html`, 'utf8')
  const files = new Map(await Promise.all(['left.png', 'right.png'].map(async filename => [filename, new Uint8Array(await readFile(`${fixture}/${filename}`))] as const)))
  const harness = await authoring(true)
  expect(await harness.apply(html, files)).toMatchObject({ commit: 'committed', usability: 'usable' })
  const first = harness.current(), surface = componentSurfaces(first)[0]!, background = surface.background!, assetIds = componentBackgroundAssetIds(background)
  expect(background.paint?.layers).toHaveLength(2)
  expect(background).not.toHaveProperty('color'); expect(background).not.toHaveProperty('assetId'); expect(background).not.toHaveProperty('fit')
  expect(background.paint!.layers[0]!.style['background-image']).toContain('linear-gradient')
  expect(background.paint!.layers[1]!.style['background-color']).toBe('rgba(255, 255, 255, 0.25)')
  expect(assetIds).toHaveLength(2)
  expect(Object.keys(first.assets).sort()).toEqual([...assetIds].sort())
  expect(Object.keys(harness.resources().assets).sort()).toEqual([...assetIds].sort())
  expect(surface.childIds).toHaveLength(2)
  expect(Object.values(first.instances).filter(instance => !instance.container).map(instance => instance.definitionId)).toEqual(['guoling.text', 'guoling.text'])
  expect(surface.childIds.every(id => !first.instances[id]!.childIds?.length)).toBe(true)
  expect(Object.values(first.instances).filter(instance => !instance.container).map(instance => instance.frame?.transform)).toEqual([[1, 0, 0, 1, 40, 30], [1, 0, 0, 1, 40, 90]])
  const original = await pixels(harness.observation().originalPixels!)
  expectPixels(original.slice(0, 2), [[229, 94, 86], [79, 109, 221]])

  expect(await harness.canonical([{ type: 'surface.presentation.set', surfaceId: surface.id, presentation: { states: [
    { id: 'clear', title: 'Clear', overrides: {}, background: { paint: null } },
    { id: 'color', title: 'Color', overrides: {}, background: structuredClone(background) },
    { id: 'paint', title: 'Paint', overrides: {}, background: { assetId: assetIds[0]!, fit: 'fill' } },
    { id: 'inherit', title: 'Inherit', overrides: {}, background: { mode: 'inherit', color: '#ff00ff' } },
  ] } }])).toMatchObject({ commit: 'committed' })
  expect(await harness.canonical(coursePresentationEdits(harness.current(), { kind: 'course-surface', surfaceId: surface.id },
    { action: 'background', state: 'color', background: { color: '#11aa33' } }))).toMatchObject({ commit: 'committed' })
  expect(await harness.canonical(coursePresentationEdits(harness.current(), { kind: 'course-surface', surfaceId: surface.id },
    { action: 'background', state: 'paint', background: structuredClone(background) }))).toMatchObject({ commit: 'committed' })
  const stateBackground = (id: string) => componentSurfaces(harness.current())[0]!.presentation!.states.find(state => state.id === id)!.background!
  expect(stateBackground('color')).not.toHaveProperty('paint')
  expect(stateBackground('paint')).not.toHaveProperty('assetId')
  const beforeSave = harness.current(), reloaded = await harness.reopen()
  expect(componentSurfaces(reloaded)).toEqual(componentSurfaces(beforeSave)); expect(reloaded.instances).toEqual(beforeSave.instances)
  expect(Object.keys(harness.resources().assets).sort()).toEqual([...assetIds].sort())
  const published = await buildPublishedCourseV3({ project: reloaded, assetBytes: harness.resources().assets })
  expect(published.offlineComplete).toBe(true); expect(published.diagnostics).toEqual([])
  expect(Object.keys(published.payload.assets).sort()).toEqual([...assetIds].sort())
  const page = await browser.newPage({ viewport })
  try {
    await page.setContent('<!doctype html><style>html,body{margin:0;width:100%;height:100%}#root{width:640px;height:360px}</style><div id="root"></div>')
    await page.addScriptTag({ content: bundle })
    await page.evaluate<void, unknown>(async value => {
      const payload = value as PublishedCourseV3
      const api = (window as any).ComplexPaint
      const artifact = await api.compileCoursePlayback(payload, { document, renderBuiltin: (instance: any, key: string, project: any) => api.renderCompiledBuiltin(instance, key, project, document) })
      ;(window as any).complexPlayer = await api.mountCompiledCourse(artifact, document.getElementById('root'))
    }, published.payload)
    expectPixels(await pixels(await page.screenshot()), original)
    const inspectPaint = () => page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('[data-compiled-surface]')!, paint = root.querySelector<HTMLElement>(':scope > [data-component-background-paint]')!
      return { first: root.firstElementChild === paint, count: paint.children.length, pointer: getComputedStyle(paint).pointerEvents,
        hitPaint: !!document.elementFromPoint(10, 10)?.closest('[data-component-background-paint]'),
        instance: !!paint.querySelector('[data-compiled-node],[data-component-object],[data-component-instance-id]'),
        images: [...paint.children].map(layer => getComputedStyle(layer).backgroundImage) }
    })
    expect(await inspectPaint()).toMatchObject({ first: true, count: 2, pointer: 'none', hitPaint: false, instance: false })
    for (const [stateId, expected] of [['clear', [[255, 255, 255], [255, 255, 255], [255, 255, 255]]], ['color', [[17, 170, 51], [17, 170, 51], [17, 170, 51]]], ['paint', original], ['inherit', original]] as const) {
      expect(await page.evaluate(async ({ id, state }) => (window as any).complexPlayer.go(id, state), { id: surface.id, state: stateId })).toBe(true)
      expectPixels(await pixels(await page.screenshot()), expected as unknown as number[][])
      const statePaint = await inspectPaint()
      expect(statePaint).toMatchObject({ count: stateId === 'clear' || stateId === 'color' ? 1 : 2, hitPaint: false, instance: false })
      if (stateId === 'clear' || stateId === 'color') expect(statePaint.images).toEqual(['none'])
    }
  } finally { await page.close() }

  const mutate = (edits: ComponentEdit[], project = reloaded) => applyComponentOperation(project, captureComponentOperation(project, edits))
  let settings = mutate(surfaceSettingsEdits(reloaded, surface.id, { background: { color: '#abcdef' } }))
  expect(componentSurfaces(settings)[0]!.background).not.toHaveProperty('paint')
  settings = mutate(surfaceSettingsEdits(settings, surface.id, { background }), settings)
  expect(componentSurfaces(settings)[0]!.background).not.toHaveProperty('color')
  settings = mutate(surfaceSettingsEdits(settings, surface.id, { background: { assetId: assetIds[0]!, fit: 'fill' } }), settings)
  expect(componentSurfaces(settings)[0]!.background).not.toHaveProperty('paint')
  const inherited = structuredClone(reloaded); inherited.background = background
  settings = mutate(surfaceSettingsEdits(inherited, surface.id, { background: { mode: 'inherit' } }), inherited)
  expect(resolveComponentBackground(settings, componentSurfaces(settings)[0]).paint).toEqual(background.paint)
  expect(settings.background).toEqual(background)
  const inheritedState = mutate(coursePresentationEdits(reloaded, { kind: 'course-surface', surfaceId: surface.id },
    { action: 'background', state: 'paint', inherit: ['color'] }))
  const state = componentSurfaces(inheritedState)[0]!.presentation!.states.find(value => value.id === 'paint')!
  expect(state.background).not.toHaveProperty('paint')
  expect(resolveComponentBackground(inheritedState, componentSurfaces(inheritedState)[0], state).paint).toEqual(background.paint)
}, 30000)

it('retains a padded content-box background as one repairable source scope without duplicating its body', async () => {
  const harness = await authoring()
  const html = '<div style="position:relative;width:640px;height:360px;box-sizing:border-box;padding:40px;background-image:linear-gradient(#fff,#abcdef);background-clip:content-box"><p style="margin:0;font:20px/1.4 Arial">Single preserved body</p></div>'
  const result = await harness.apply(html)
  expect(result).toMatchObject({ commit: 'committed', usability: 'partial' })
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'html-page-background-source-retained', repairable: true }))
  const project = harness.current(), instances = Object.values(project.instances).filter(instance => !instance.container)
  expect(instances).toHaveLength(1)
  const retained = instances[0]!.data as { html: string }
  expect(retained.html).toContain('padding:40px')
  expect(retained.html).toContain('background-clip:content-box')
  expect(retained.html.match(/Single preserved body/g)).toHaveLength(1)
  expect(instances[0]!.childIds ?? []).toEqual([])
  expect(componentSurfaces(project)[0]!.background?.paint).toBeUndefined()
}, 10000)
