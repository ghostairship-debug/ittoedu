// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest'
import { build } from 'esbuild'
import { chromium, type Browser } from 'playwright'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { assembleMeasuredHtml, type HtmlDesignCapture } from '../../src/core/contentApply/assembly/htmlAssembly'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { ContentApplyService } from '../../src/main/workbench/contentApply/applyService'
import { prepareMeasurementDocument, retainedMeasurementScopeHtml } from '../../src/main/workbench/contentApply/measurement/prepareMeasurementDocument'
import type { HtmlDesignMeasurementRequest } from '../../src/main/workbench/contentApply/measurement/ElectronHtmlDesignMeasurement'
import type { ComponentInstance, CourseProjectV10, JsonObject } from '../../src/shared/contracts/component-platform'

let browser: Browser, captureBundle: string
beforeAll(async () => {
  const bundle = await build({ stdin: { contents: `export {captureHtmlDesignViewport} from './src/main/workbench/contentApply/measurement/browserCapture';export {cssUsesViewport} from './src/components/web/measuredFragmentBox';`,
    resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'CursorThemeCapture', target: 'es2022' })
  captureBundle = bundle.outputFiles[0]!.text
  browser = await chromium.launch({ headless: true })
})
afterAll(async () => { await browser?.close() })

async function measure(request: HtmlDesignMeasurementRequest, probeHover: boolean) {
  const prepared = prepareMeasurementDocument(request), page = await browser.newPage({ viewport: request.viewport })
  try {
    await page.setContent('<!doctype html><body></body>')
    await page.addScriptTag({ content: captureBundle })
    await page.setContent(prepared.html)
    const injectedTheme = await page.locator('[data-guoling-measurement-course-theme]').textContent()
    const capture = await page.evaluate(() => { const api = (window as any).CursorThemeCapture; return api.captureHtmlDesignViewport(200, api.cssUsesViewport) }) as HtmlDesignCapture
    let before: string | undefined, after: string | undefined
    if (probeHover) {
      before = await page.locator('.detail').evaluate(element => getComputedStyle(element).display)
      await page.locator('.panel').hover()
      after = await page.locator('.detail').evaluate(element => getComputedStyle(element).display)
    }
    const source = { html: request.html, ...(request.themeCss === undefined ? {} : { themeCss: request.themeCss }) }
    for (const element of capture.elements) {
      const original = prepared.originalElements.get(element.sourcePath.join('/'))
      if (original) { element.attributes = original.attributes; element.sourceHtml = original.sourceHtml }
    }
    for (const scope of capture.sourceScopes ?? []) scope.html = retainedMeasurementScopeHtml(source, capture.elements[scope.index]!.sourcePath)
    return { capture, injectedTheme, before, after,
      assembly: assembleMeasuredHtml(capture, source, request.framing ?? (prepared.documentKind === 'document' ? 'viewport' : 'content')) }
  } finally { await page.close() }
}

async function applyHtml(html: string, themeCss?: string) {
  const project = createBlankCourseProjectV10('Cursor theme ownership')
  if (themeCss !== undefined) project.theme = { css: themeCss }
  const driver = new CourseV10Driver(), registry = new DocumentRegistry({ drivers: [driver], createId: randomUUID,
    bindingKey: binding => binding.path, persistence: { async append() {}, async save() { throw new Error('No save is needed to prove this assembly regression') } } })
  const session = await registry.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'cursor-theme.glx')
  const current = (): CourseProjectV10 => { const model = session.read().model; if (model.kind !== 'course-v10') throw new Error('Expected V10'); return model.project }
  let observed: Awaited<ReturnType<typeof measure>> | undefined
  const service = new ContentApplyService({ session: { project: current, dispatch: command => {
    const snapshot = session.read()
    return session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision,
      operationId: randomUUID(), actor: 'agent', mutation: { type: 'command', command } })
  } }, measure: async request => { observed = await measure(request, html.includes('class="detail"')); return observed.assembly },
    compilation: { async compile() { throw new Error('Static HTML assembly must not compile Source') } } })
  const result = await service.apply({ intent: 'insert', target: { kind: 'container', container: { kind: 'surface', surfaceId: project.surfaces[0]!.id } },
    source: { kind: 'html', html } })
  return { result, project: current(), snapshot: session.read(), observed: observed! }
}

const data = (instance: ComponentInstance) => instance.data as JsonObject
const textOf = (instance: ComponentInstance) => (data(instance).content as { inlines?: { text?: string }[] } | undefined)?.inlines?.map(inline => inline.text ?? '').join('')

it('keeps the real default cursor theme while assembling the frozen static page into background and independent text', async () => {
  // Exact surface.add.pages[1].content from run f6adaebb-1c0a-4e1d-bf8c-4beb4e71c801.
  // The checked-in fixture is independent of the ignored active run/profile/output.
  const html = await readFile('tests/fixtures/cursorThemeStaticPage20261017.html', 'utf8')
  const authored = await applyHtml(html)
  expect(authored.observed.injectedTheme).toMatch(/:where\(button:disabled,\s*input:disabled/)
  expect(authored.observed.injectedTheme).toMatch(/cursor:\s*default/)
  expect(authored.result).toMatchObject({ commit: 'committed', usability: 'usable' })
  expect(authored.observed.capture.sourceScopes).toEqual([])
  expect(authored.snapshot).toMatchObject({ revision: 1, undoDepth: 1 })
  const surface = authored.project.surfaces[0]!, roots = surface.childIds.map(id => authored.project.instances[id]!)
  expect(surface.background).toEqual({ mode: 'own', color: 'rgb(245, 247, 239)', assetId: null })
  expect(roots).toHaveLength(5)
  expect(roots.every(instance => instance.definitionId === 'guoling.text')).toBe(true)
  expect(roots.map(textOf)).toContain('如果让土地多喝一点水？')
  expect(Object.values(authored.project.instances).some(instance => instance.frame?.width === 1280 && instance.frame.height === 720)).toBe(false)
})

const stateCss = '.detail{display:none}.panel:where(:hover) .detail{display:block}'
it.each(['author', 'theme'] as const)('retains actual %s state CSS that reveals content and changes layout', async owner => {
  const html = `<!doctype html><html><head><style>html,body{margin:0;width:1280px;height:720px}body{background:#f5f7ef;font:24px sans-serif}p{margin:0}.panel{width:300px;margin:140px 0 0 80px}${owner === 'author' ? stateCss : ''}</style></head><body><div class="panel"><p>Reveal the next result</p><p class="detail">The real extra content</p></div><p>Following paragraph</p></body></html>`
  const authored = await applyHtml(html, owner === 'theme' ? stateCss : undefined)
  expect(authored.result).toMatchObject({ commit: 'committed', usability: 'usable' })
  expect(authored.observed).toMatchObject({ before: 'none', after: 'block' })
  expect(authored.observed.capture.sourceScopes).toContainEqual(expect.objectContaining({ reason: expect.stringContaining('state-css-context') }))
  expect(authored.project.surfaces[0]!.background).toBeUndefined()
  const roots = authored.project.surfaces[0]!.childIds.map(id => authored.project.instances[id]!)
  expect(roots).toHaveLength(1)
  expect(data(roots[0]!).html).toContain('The real extra content')
  expect(authored.observed.assembly.root.retainedSource).toBeDefined()
})
