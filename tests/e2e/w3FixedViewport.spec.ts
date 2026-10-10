import { expect, test, type Page } from '@playwright/test'
import { build } from 'esbuild'
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ContentApplyService } from '../../src/main/workbench/contentApply/applyService'
import { prepareMeasurementDocument, retainedMeasurementScopeHtml } from '../../src/main/workbench/contentApply/measurement/prepareMeasurementDocument'
import { assembleMeasuredHtml, sourceProgramAssembly } from '../../src/core/contentApply/assembly/htmlAssembly'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { buildPublishedCourseV3 } from '../../src/core/publish/componentPlatform'
import { buildComponentSingleHtml } from '../../src/core/publish/componentPlatform/buildSingleHtml'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import { prepareImageResource } from '../../src/main/workbench/admittedImageResource'
import { replaceImageSource, imageDataSchema } from '../../src/components/image/data'
import { buildComponentPrintHtml } from '../../src/renderer/export/componentPlatform/print'
import { PDFDocument } from 'pdf-lib'
import { unzipSync, strFromU8 } from 'fflate'
import type { DocumentSnapshot, DocumentEvent } from '../../src/shared/workbench/document'
import type { ContentApplyRequest } from '../../src/core/contentApply/planning/types'
import type { HtmlDesignCapture } from '../../src/core/contentApply/assembly/htmlAssembly'

const course = (snapshot: DocumentSnapshot) => {
  if (snapshot.model.kind !== 'course-v10') throw new Error('Expected V10')
  return snapshot.model
}
const json = (value: unknown) => JSON.parse(JSON.stringify(value, (_key, item) => item instanceof Uint8Array ? [...item] : item))

async function mountMainEditor(editor: Page, host: DocumentHostService, documentId: string, events: DocumentEvent[], bundle: string) {
  await editor.route('http://localhost/w3-editor', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>html,body,#editor{margin:0;width:100%;height:100%}#editor{position:relative}</style><div id="editor"></div>' }))
  await editor.goto('http://localhost/w3-editor')
  const api = host.internalAPI as any
  await editor.exposeFunction('w3DocumentCall', async (name: string, args: unknown[]) => {
    const result = name === 'bootstrapCourse' ? await host.internalAPI.read(documentId)
      : name === 'readAuthoringDrafts' ? await host.readAuthoringDrafts(args[0] as string)
      : name === 'writeAuthoringDrafts' ? await host.writeAuthoringDrafts(args[0] as string, args[1] as any)
      : name === 'clearAuthoringDrafts' ? await host.clearAuthoringDrafts(args[0] as string)
      : await api[name](...args)
    return json({ result, events: events.splice(0) })
  })
  await editor.evaluate(bundle)
  await editor.evaluate(async () => {
    const listeners = new Set<(event: any) => void>()
    const hydrate = (snapshot: any) => {
      if (snapshot?.model?.resources) for (const family of ['assets', 'components']) {
        const values = snapshot.model.resources[family]
        for (const [id, value] of Object.entries(values)) values[id] = family === 'assets' ? Uint8Array.from(value as number[])
          : Object.fromEntries(Object.entries(value as object).map(([name, bytes]) => [name, Uint8Array.from(bytes as number[])]))
      }
      return snapshot
    }
    const receive = (events: any[]) => events.forEach(event => { if (event.snapshot) hydrate(event.snapshot); listeners.forEach(listener => listener(event)) })
    ;(window as any).w3Receive = receive
    const methods = ['list','read','dispatch','restore','save','bootstrapCourse','readAuthoringDrafts','writeAuthoringDrafts','clearAuthoringDrafts']
    const api = {
      ...Object.fromEntries(methods.map(name => [name, async (...args: any[]) => {
        const packet = await (window as any).w3DocumentCall(name, args); receive(packet.events)
        return Array.isArray(packet.result) ? packet.result.map(hydrate) : hydrate(packet.result)
      }])),
      subscribe: (listener: (event: any) => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    }
    ;(window as any).w3Harness = await (window as any).W3Editor.mountCurrentCourseBrowserHarness(document.getElementById('editor'), api)
  })
}

/** Real browser measurement, canonical Main history/file save, editor gesture and exported V3 consumer. */
test('fixed design creation survives a human drag, local AI edits, cold reopen and HTML window fitting', async ({ browser }, info) => {
  test.setTimeout(120_000)
  const directory = info.outputPath('work'), root = resolve(__dirname, '../..')
  await fs.mkdir(directory, { recursive: true })
  const bundle = async (contents: string, globalName: string) => {
    const result = await build({ stdin: { contents, resolveDir: root }, bundle: true, platform: 'browser', format: 'iife', globalName,
      write: false, outfile: join(directory, globalName + '.js'), loader: { '.css': 'css', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' }, logLevel: 'silent' })
    const css = result.outputFiles.find(file => file.path.endsWith('.css'))?.text
    return (css ? `(()=>{const style=document.createElement('style');style.textContent=${JSON.stringify(css)};document.head.append(style)})();` : '') + result.outputFiles.find(file => file.path.endsWith('.js'))!.text
  }
  const measureBundle = await bundle('export {captureHtmlDesignViewport} from "./src/main/workbench/contentApply/measurement/browserCapture"', 'W3Capture')
  const editorBundle = await bundle('import "./src/renderer/styles/globals.css"; export * from "./tests/helpers/currentCourseBrowserHarness"', 'W3Editor')
  const playerBundle = await bundle('export * from "./src/player/componentPlatform/entry"', 'CoursewarePlayer')
  const officeBundle = await bundle('export {buildComponentPptx} from "./src/renderer/export/componentPlatform/pptx"', 'W3Office')
  const measurement = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  const host = new DocumentHostService(join(directory, 'recovery')), project = createBlankCourseProjectV10('固定视口连续编辑')
  project.surfaces[0]!.designSize = { width: 1280, height: 720 }
  const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'work.h5lesson')
  const compilation = new InMemoryComponentCompilation(createEsbuildComponentCompiler()), events: DocumentEvent[] = []
  const off = host.subscribeEvents(event => events.push(event))
  const apply = async (request: ContentApplyRequest) => {
    const baseline = await host.internalAPI.read(initial.documentId), model = course(baseline)
    const service = new ContentApplyService({ compilation, session: { project: () => model.project, resources: () => model.resources,
      dispatch: command => host.internalAPI.dispatch({ documentId: baseline.documentId, epoch: baseline.epoch, baseRevision: baseline.revision,
        actor: 'agent', operationId: randomUUID(), runId: 'w3', mutation: { type: 'command', command } }) },
      measure: async request => {
        const prepared = prepareMeasurementDocument(request), source = { html: request.html, themeCss: request.themeCss }
        if (prepared.documentProgramReason) return sourceProgramAssembly(request.viewport, source, prepared.documentProgramReason)
        await measurement.setViewportSize(request.viewport); await measurement.setContent(prepared.html)
        await measurement.evaluate(measureBundle)
        const capture = await measurement.evaluate(() => (window as any).W3Capture.captureHtmlDesignViewport(5000)) as HtmlDesignCapture
        for (const element of capture.elements) {
          const original = prepared.originalElements.get(element.sourcePath.join('/'))
          if (original) { element.attributes = original.attributes; element.sourceHtml = original.sourceHtml }
        }
        for (const scope of capture.sourceScopes ?? []) scope.html = retainedMeasurementScopeHtml(source, capture.elements[scope.index]!.sourcePath)
        return assembleMeasuredHtml(capture, source, request.framing ?? (prepared.documentKind === 'document' ? 'viewport' : 'content'))
      } })
    const result = await service.apply(request)
    expect(result.commit, JSON.stringify(result.diagnostics)).toBe('committed')
    return result
  }
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#3b82f6"/></svg>'
  const html = '<!doctype html><html><head><style>html,body{margin:0;font:20px Arial}h1,p,figure{margin:0}img{width:120px;height:80px}figure{display:block}</style></head><body>'
    + '<section style="display:grid;grid-template-columns:1fr 1fr;gap:24px;padding:24px"><div style="display:flex;flex-direction:column;gap:12px">'
    + '<h1>实验原理</h1><p style="line-height:normal">这段说明应能独立选择、修改和自由摆放。</p></div><figure><img src="diagram.svg" alt="实验装置示意图">'
    + '<figcaption>更换图片后保留题注和人工位置。</figcaption></figure></section></body></html>'
  try {
    await apply({ intent: 'insert', target: { kind: 'container', container: { kind: 'surface', surfaceId: project.surfaces[0]!.id } },
      source: { kind: 'html', html, siblingFiles: new Map([['diagram.svg', new TextEncoder().encode(svg)]]) } })
    let current = await host.internalAPI.read(initial.documentId), model = course(current)
    const textIds = Object.values(model.project.instances).filter(instance => model.project.definitions[instance.definitionId]?.implementation.kind === 'builtin'
      && (model.project.definitions[instance.definitionId]!.implementation as any).key === 'guoling.text').map(instance => instance.id)
    expect(textIds).toHaveLength(3)
    const findText = (source: string) => textIds.find(id => JSON.stringify(model.project.instances[id]!.data).includes(source))!
    const paragraphId = findText('这段说明'), captionId = findText('更换图片'), image = Object.values(model.project.instances).find(instance => (model.project.definitions[instance.definitionId]?.implementation as any)?.key === 'guoling.image')!
    expect((model.project.instances[paragraphId]!.data as any).appearance.lineHeight).toBe('normal')
    const editor = await browser.newPage({ viewport: { width: 1280, height: 760 } })
    const editorErrors: string[] = []; editor.on('pageerror', error => editorErrors.push(String(error)))
    await mountMainEditor(editor, host, initial.documentId, events, editorBundle)
    const originalFrame = structuredClone(model.project.instances[paragraphId]!.frame!)
    const locator = editor.locator(`[data-component-instance="${paragraphId}"]`).first()
    await expect.poll(() => editor.evaluate(() => (window as any).w3Harness.errors)).toEqual([])
    await expect(locator).toBeVisible()
    // Enter the containing native group through the real editor before moving its text box.
    const initialBox = await locator.boundingBox()
    if (!initialBox) throw new Error('Text box missing')
    // The real authoring overlay receives the pointer; it is intentionally above runtime content.
    await editor.mouse.dblclick(initialBox.x + initialBox.width / 2, initialBox.y + initialBox.height / 2)
    await editor.keyboard.press('Escape')
    await editor.evaluate(({ id, surfaceId }) => {
      const store = (window as any).W3Editor.useEditorStore.getState()
      store.courseBridge.selectInstances(store.courseView.activeDocumentId, [id], surfaceId)
    }, { id: paragraphId, surfaceId: project.surfaces[0]!.id })
    const box = await locator.boundingBox()
    if (!box) throw new Error('Text box missing')
    await editor.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await editor.mouse.down()
    await editor.mouse.move(box.x + box.width / 2 + 170, box.y + box.height / 2 + 130, { steps: 12 }); await editor.mouse.up()
    await expect.poll(async () => JSON.stringify(course(await host.internalAPI.read(initial.documentId)).project.instances[paragraphId]!.frame)).not.toBe(JSON.stringify(originalFrame))
    current = await host.internalAPI.read(initial.documentId); model = course(current)
    const humanFrame = structuredClone(model.project.instances[paragraphId]!.frame!)
    await editor.evaluate(({ id, surfaceId }) => {
      const store = (window as any).W3Editor.useEditorStore.getState()
      store.courseBridge.selectInstances(store.courseView.activeDocumentId, [id], surfaceId)
    }, { id: image.id, surfaceId: project.surfaces[0]!.id })
    const handle = editor.locator('[data-testid="slide-layer-selection-overlay"] [data-handle="se"]').first()
    await expect(handle).toBeVisible()
    const imageBox = await editor.locator(`[data-component-instance="${image.id}"]`).first().boundingBox()
    if (!imageBox) throw new Error('Image box missing')
    await expect.poll(async () => {
      const value = await handle.boundingBox()
      return value ? Math.abs(value.x + value.width / 2 - imageBox.x - imageBox.width) : Infinity
    }).toBeLessThan(1)
    const handleBox = await handle.boundingBox()
    if (!handleBox) throw new Error('Image resize handle missing')
    await editor.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2); await editor.mouse.down()
    await editor.mouse.move(handleBox.x + handleBox.width / 2 + 48, handleBox.y + handleBox.height / 2 + 32, { steps: 8 }); await editor.mouse.up()
    await expect.poll(async () => {
      const frame = course(await host.internalAPI.read(initial.documentId)).project.instances[image.id]!.frame!
      return frame.width * Math.hypot(frame.transform[0], frame.transform[1])
    }).toBeGreaterThan(image.frame!.width)
    current = await host.internalAPI.read(initial.documentId); model = course(current)
    const preservedImageFrame = structuredClone(model.project.instances[image.id]!.frame!)
    const projection = componentProjectFiles(model.project, model.resources).find(file => file.kind === 'page')!
    expect(projection.content).toContain(`matrix(${humanFrame.transform.join(',')})`)
    expect(projection.content).toContain('width:1280px;height:720px')
    const expanded = '这段说明应能独立选择、修改和自由摆放。'.repeat(8)
    await apply({ intent: 'content', target: projection.target!, projection: projection.projection!,
      source: { kind: 'html', scope: 'projection', html: projection.content!.replace('这段说明应能独立选择、修改和自由摆放。', expanded) } })
    current = await host.internalAPI.read(initial.documentId); model = course(current)
    expect(model.project.instances[paragraphId]!.frame).toEqual(humanFrame)
    expect(model.project.instances[image.id]!.frame).toEqual(preservedImageFrame)
    const color = '#dc2626'
    const captionBefore = structuredClone(model.project.instances[captionId]!), captionTarget = { kind: 'course-instance' as const,
      surfaceId: project.surfaces[0]!.id, instanceId: captionId }
    await host.tools.beginRun({ runId: 'w3-caption', actor: 'agent', documents: [{ documentId: initial.documentId, writable: [captionTarget] }] })
    const captionHandle = await host.tools.issueTarget('w3-caption', initial.documentId, captionTarget)
    const appearanceResult = await host.tools.execute('w3-caption', 'appearance', { name: 'object.update', input: { target: captionHandle,
      properties: { appearance: { color, shadows: [{ x: 2, y: 3, blur: 4, color: '#000000' }] } } } })
    expect(appearanceResult).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    await host.tools.stop('w3-caption')
    // Replace an actual admitted local resource, retaining the same editable image and human frame.
    const replacement = await prepareImageResource({ bytes: new TextEncoder().encode(svg.replace('#3b82f6', '#dc2626')),
      mimeType: 'image/svg+xml', filename: 'replacement.svg' }, randomUUID)
    current = await host.internalAPI.read(initial.documentId); model = course(current)
    const beforeImageData = imageDataSchema.parse(model.project.instances[image.id]!.data)
    await apply({ intent: 'canonical', edits: [{ type: 'asset.add', asset: replacement.meta, bytes: replacement.bytes },
      { type: 'data.set', instanceId: image.id, path: [], value: replaceImageSource(beforeImageData, replacement.meta.id) as any }] })
    // A declared local program is a separate framed object; ordinary text/image objects stay native.
    const local = await apply({ intent: 'insert', target: { kind: 'container', container: { kind: 'surface', surfaceId: project.surfaces[0]!.id } },
      viewport: { width: 280, height: 160 }, source: { kind: 'html', html: '<!doctype html><style>body{margin:0;font:20px Arial}button{font:inherit}</style><button id="switch">开关</button><button id="reset">复位</button><output id="state">关闭</output><script>let on=false;const state=document.getElementById("state");document.getElementById("switch").onclick=()=>{on=!on;state.textContent=on?"开启":"关闭"};document.getElementById("reset").onclick=()=>{on=false;state.textContent="关闭"}</script>' } })
    const localId = local.insertedIds[0]!
    current = await host.internalAPI.read(initial.documentId); model = course(current)
    const localFrame = model.project.instances[localId]!.frame!
    await apply({ intent: 'canonical', edits: [{ type: 'frame.set', instanceId: localId,
      frame: { ...localFrame, transform: [1, 0, 0, 1, 900, 400] } }] })
    current = await host.internalAPI.read(initial.documentId); model = course(current)
    expect(model.project.instances[paragraphId]!.frame).toEqual(humanFrame)
    expect(model.project.instances[image.id]!.frame).toEqual(preservedImageFrame)
    expect(imageDataSchema.parse(model.project.instances[image.id]!.data)).toEqual(replaceImageSource(beforeImageData, replacement.meta.id))
    expect(model.project.instances[captionId]!.frame).toEqual(captionBefore.frame)
    expect((model.project.instances[captionId]!.data as any).appearance.fontSize).toBe((captionBefore.data as any).appearance.fontSize)
    expect(textIds.every(id => (model.project.definitions[model.project.instances[id]!.definitionId]!.implementation as any).key === 'guoling.text')).toBe(true)
    await editor.evaluate(packet => (window as any).w3Receive(packet), json(events.splice(0)))
    await expect(locator.locator('[data-text-component-content]')).toHaveText(expanded)
    const editorMetrics = await locator.locator('[data-text-component-content]').evaluate((element: HTMLElement) => ({
      fontSize: getComputedStyle(element).fontSize, lineHeight: getComputedStyle(element).lineHeight,
      width: element.clientWidth, height: element.clientHeight, text: element.textContent,
    }))
    const captionMetrics = await editor.locator(`[data-component-instance="${captionId}"] [data-text-component-content]`).evaluate(element => ({
      color: getComputedStyle(element).color, shadow: getComputedStyle(element).textShadow, fontSize: getComputedStyle(element).fontSize,
    }))
    expect(captionMetrics.color).toBe('rgb(220, 38, 38)'); expect(captionMetrics.shadow).toBe('rgb(0, 0, 0) 2px 3px 4px')
    const filename = join(directory, 'fixed-work.h5lesson'); await host.saveToPath(initial.documentId, filename)
    const reopened = await new DocumentHostService(join(directory, 'cold')).open(filename)
    expect(course(reopened).project.instances).toEqual(model.project.instances)
    const published = await buildPublishedCourseV3({ project: model.project, assetBytes: model.resources.assets, componentFiles: model.resources.components }, { compilation })
    const exported = buildComponentSingleHtml(published.payload, playerBundle)
    await fs.writeFile(join(directory, 'fixed-work.html'), exported)
    const output = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    await output.route('http://localhost/w3-output', route => route.fulfill({ contentType: 'text/html', body: exported }))
    await output.goto('http://localhost/w3-output'); await output.evaluate(() => (window as any).coursePlayerReady)
    const observe = () => output.locator(`[data-component-object="${paragraphId}"]`).evaluate((element: HTMLElement) => {
      const content = element.querySelector<HTMLElement>('[data-text-component-content]')!, rect = element.getBoundingClientRect()
      return { style: element.style.cssText, lineHeight: getComputedStyle(content).lineHeight, fontSize: getComputedStyle(content).fontSize,
        textWidth: content.clientWidth, textHeight: content.clientHeight, text: content.textContent, width: rect.width, height: rect.height }
    })
    const full = await observe(); expect(full.lineHeight).toBe('normal')
    expect({ fontSize: full.fontSize, lineHeight: full.lineHeight, width: full.textWidth, height: full.textHeight, text: full.text }).toEqual(editorMetrics)
    expect(await output.locator(`[data-component-object="${captionId}"] [data-text-component-content]`).evaluate(element => ({
      color: getComputedStyle(element).color, shadow: getComputedStyle(element).textShadow, fontSize: getComputedStyle(element).fontSize,
    }))).toEqual(captionMetrics)
    const localFrameConsumer = output.frameLocator(`[data-component-object="${localId}"] iframe`)
    await localFrameConsumer.getByRole('button', { name: '开关', exact: true }).click()
    await expect(localFrameConsumer.locator('#state')).toHaveText('开启')
    await localFrameConsumer.getByRole('button', { name: '复位', exact: true }).click()
    await expect(localFrameConsumer.locator('#state')).toHaveText('关闭')
    const displayedImage = output.locator(`[data-component-object="${image.id}"] img`)
    expect(await displayedImage.evaluate((element: HTMLImageElement) => ({ complete: element.complete, width: element.naturalWidth, height: element.naturalHeight })))
      .toEqual({ complete: true, width: 120, height: 80 })
    // The existing static producer uses an actual player capture. It deliberately omits interaction.
    const screenshot = await output.screenshot({ path: join(directory, 'author-initial.png') })
    const print = await buildComponentPrintHtml(model.project, { surfaceId: project.surfaces[0]!.id,
      captureSurface: async () => [{ dataUrl: 'data:image/png;base64,' + screenshot.toString('base64'), width: 1280, height: 720 }] })
    expect(print.diagnostics).toEqual([expect.objectContaining({ code: 'actual-static-surface' })])
    const printed = await browser.newPage()
    await printed.setContent(print.html)
    const pdf = await printed.pdf({ printBackground: true, preferCSSPageSize: true, path: join(directory, 'fixed-work.pdf') })
    const pdfDocument = await PDFDocument.load(pdf)
    expect(pdfDocument.getPageCount()).toBe(1)
    expect(pdfDocument.getPage(0).getSize()).toEqual({ width: 960, height: 540 })
    await printed.close()
    // Produce a real editable PPTX with the existing format diagnostics and actual local captures.
    // Office rendering is outside this browser environment; the package checks are not visual parity.
    const captures: string[] = []
    await output.exposeFunction('w3CaptureLocal', async (id: string) => {
      captures.push(id)
      const bytes = await output.locator(`[data-component-runtime-root="${id}"]`).screenshot()
      return 'data:image/png;base64,' + bytes.toString('base64')
    })
    await output.evaluate(officeBundle)
    const assetUrls = Object.fromEntries(Object.entries(model.resources.assets).map(([id, bytes]) => [id,
      `data:${model.project.assets[id]!.mimeType};base64,${Buffer.from(bytes).toString('base64')}`]))
    const pptx = await output.evaluate(async ({ input, assetUrls }) => {
      const result = await (window as any).W3Office.buildComponentPptx(input, { resolveAsset: (id: string) => assetUrls[id],
        captureInstance: ({ instance }: any) => (window as any).w3CaptureLocal(instance.id) })
      return { ...result, bytes: [...result.bytes] }
    }, { input: json(model.project), assetUrls })
    expect(pptx.slideCount).toBe(1); expect(pptx.status).not.toBe('empty')
    expect(pptx.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ instanceId: paragraphId,
      message: expect.stringContaining('normal') })]))
    expect(captures).toContain(localId)
    const pptxBytes = Uint8Array.from(pptx.bytes); await fs.writeFile(join(directory, 'fixed-work.pptx'), pptxBytes)
    const packageFiles = unzipSync(pptxBytes), slideXml = strFromU8(packageFiles['ppt/slides/slide1.xml']!)
    expect(slideXml).toContain('更换图片后保留题注和人工位置。'); expect(slideXml).not.toContain('NaN')
    await output.setViewportSize({ width: 640, height: 360 })
    await expect.poll(async () => (await observe()).width).toBeCloseTo(full.width / 2, 1)
    const half = await observe()
    expect(half.style).toBe(full.style); expect(half.fontSize).toBe(full.fontSize)
    expect(half.width).toBeCloseTo(full.width / 2, 1); expect(half.height).toBeCloseTo(full.height / 2, 1)
    await output.setViewportSize({ width: 480, height: 900 })
    await expect.poll(async () => (await observe()).width).toBeCloseTo(full.width * 480 / 1280, 1)
    const portrait = await observe()
    expect(portrait.style).toBe(full.style); expect(portrait.fontSize).toBe(full.fontSize)
    expect(await output.locator('#course-diagnostic').textContent()).toBe('')
    await output.screenshot({ path: join(directory, 'portrait.png') })
    await fs.writeFile(join(directory, 'facts.json'), JSON.stringify({ humanFrame, preservedImageFrame, editorMetrics,
      full, half, portrait, textIds, captionMetrics, replacementAsset: replacement.meta.id, localId, localSwitchReset: true, reopened: true, export: true,
      pdfPage: pdfDocument.getPage(0).getSize(), pptx: { status: pptx.status, diagnostics: pptx.diagnostics, actualLocalCaptures: captures } }, null, 2))
    await editor.evaluate(() => (window as any).w3Harness.dispose()); await editor.close(); await output.close()
  } finally { off(); await measurement.close() }
})

// Long Flow text keeps its logical reading width; a small host scrolls instead of rewrapping.
test('Flow HTML keeps the authored reading width and natural height in narrow hosts', async ({ browser }, info) => {
  const { TEXT_DEFINITION } = await import('../../src/components/text/adapters')
  const { createTextComponentData } = await import('../../src/components/text/data')
  const project = createBlankCourseProjectV10('固定逻辑阅读宽度'), surface = project.surfaces[0]!
  surface.kind = 'flow'; delete surface.designSize
  surface.flow = { layout: { widthMode: 'reading', readingWidth: 860, wideContentWidth: 1100, paperBackgroundColor: '#fff' } }
  project.global = { underlay: [], overlay: [] }; project.instances = {}; project.definitions = { [TEXT_DEFINITION.id]: TEXT_DEFINITION }
  const data = createTextComponentData('固定阅读宽度下的长正文，窄窗口只能滚动，不改文字排版。'.repeat(100))
  data.appearance.fontFamily = 'Arial'; data.appearance.lineHeight = 'normal'
  project.instances.body = { id: 'body', definitionId: TEXT_DEFINITION.id, data: data as any }
  project.instances.float = { id: 'float', definitionId: TEXT_DEFINITION.id, data: createTextComponentData('自由文本框') as any,
    frame: { width: 180, height: 40, transform: [1, 0, 0, 1, 560, 40] }, flowPlacement: { space: 'paper', plane: 'overlay' } }
  surface.childIds = ['body', 'float']
  const directory = info.outputPath('flow-main'); await fs.mkdir(directory, { recursive: true })
  const host = new DocumentHostService(join(directory, 'recovery')), events: DocumentEvent[] = []
  const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'flow.h5lesson')
  const off = host.subscribeEvents(event => events.push(event))
  const flowEditorBuild = await build({ stdin: { contents: 'import "./src/renderer/styles/globals.css"; export * from "./tests/helpers/currentFlowBrowserHarness"',
    resolveDir: resolve(__dirname, '../..') }, bundle: true, platform: 'browser', format: 'iife', globalName: 'W3Editor', write: false,
    outfile: join(directory, 'flow-editor.js'), loader: { '.css': 'css', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' }, logLevel: 'silent' })
  const editorCss = flowEditorBuild.outputFiles.find(file => file.path.endsWith('.css'))!.text
  const editorBundle = `(()=>{const style=document.createElement('style');style.textContent=${JSON.stringify(editorCss)};document.head.append(style)})();`
    + flowEditorBuild.outputFiles.find(file => file.path.endsWith('.js'))!.text
  const editor = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  await mountMainEditor(editor, host, initial.documentId, events, editorBundle)
  const paragraph = editor.locator('[data-flow-block-id="body"]')
  await expect(paragraph).toBeVisible()
  const observeEditor = () => paragraph.evaluate((element: HTMLElement) => {
    const style = getComputedStyle(element), paper = element.closest('article')!
    return { paperWidth: paper.getBoundingClientRect().width, fontSize: style.fontSize, lineHeight: style.lineHeight,
      textWidth: element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      textHeight: element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom), text: element.textContent }
  })
  await expect.poll(async () => (await observeEditor()).lineHeight).toBe('normal')
  const editorWide = await observeEditor()
  await editor.setViewportSize({ width: 360, height: 720 })
  await expect.poll(observeEditor).toEqual(editorWide)
  // Expand through the real SharedDocumentEditor and its Main command bridge.
  await paragraph.click(); await editor.keyboard.press('Control+End'); await editor.keyboard.insertText('人工扩写后仍保留固定阅读宽度。'.repeat(20))
  await expect.poll(async () => JSON.stringify(course(await host.internalAPI.read(initial.documentId)).project.instances.body!.data)).toContain('人工扩写')
  await expect.poll(async () => (await observeEditor()).textHeight).toBeGreaterThan(editorWide.textHeight)
  const expandedEditor = await observeEditor(), current = course(await host.internalAPI.read(initial.documentId))
  expect(current.project.instances.float!.frame).toEqual(project.instances.float!.frame)
  await host.saveToPath(initial.documentId, join(directory, 'flow.h5lesson'))
  const reopened = await new DocumentHostService(join(directory, 'cold')).open(join(directory, 'flow.h5lesson'))
  expect(course(reopened).project.instances).toEqual(current.project.instances)
  const published = await buildPublishedCourseV3({ project: current.project, assetBytes: current.resources.assets, componentFiles: current.resources.components })
  const result = await build({ stdin: { contents: 'export * from "./src/player/componentPlatform/entry"', resolveDir: resolve(__dirname, '../..') },
    bundle: true, platform: 'browser', format: 'iife', globalName: 'CoursewarePlayer', write: false,
    loader: { '.css': 'empty' }, logLevel: 'silent' })
  const html = buildComponentSingleHtml(published.payload, result.outputFiles[0]!.text), filename = info.outputPath('flow.html')
  await fs.writeFile(filename, html)
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  try {
    await page.route('http://localhost/w3-flow', route => route.fulfill({ contentType: 'text/html', body: html }))
    await page.goto('http://localhost/w3-flow'); await page.evaluate(() => (window as any).coursePlayerReady)
    const observe = () => page.evaluate(() => {
      const body = document.querySelector<HTMLElement>('[data-component-object="body"]')!, paper = body.closest('article')!
      const text = body.querySelector<HTMLElement>('[data-text-component-content]')!, float = document.querySelector<HTMLElement>('[data-component-object="float"]')!
      return { paperWidth: paper.getBoundingClientRect().width, bodyWidth: body.getBoundingClientRect().width,
        textHeight: text.getBoundingClientRect().height, textWidth: text.clientWidth, text: text.textContent,
        fontSize: getComputedStyle(text).fontSize, lineHeight: getComputedStyle(text).lineHeight, float: float.style.cssText }
    })
    const wide = await observe(); expect(wide.paperWidth).toBe(860); expect(wide.textHeight).toBeGreaterThan(720)
    expect({ paperWidth: wide.paperWidth, fontSize: wide.fontSize, lineHeight: wide.lineHeight, textWidth: wide.textWidth, textHeight: wide.textHeight, text: wide.text }).toEqual(expandedEditor)
    await page.setViewportSize({ width: 360, height: 720 })
    await expect.poll(observe).toEqual(wide)
    expect(await page.locator('#course-diagnostic').textContent()).toBe('')
    await page.screenshot({ path: info.outputPath('flow-narrow.png') })
    await fs.writeFile(info.outputPath('flow-facts.json'), JSON.stringify({ editorWide, expandedEditor, player: wide, reopened: true }, null, 2))
  } finally { off(); await editor.evaluate(() => (window as any).w3Harness.dispose()); await editor.close(); await page.close() }
})
