// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest'
import { build } from 'esbuild'
import { chromium, type Browser } from 'playwright'
import { strFromU8, unzipSync } from 'fflate'
import { PDFDocument, PDFDict, PDFName } from 'pdf-lib'
import sharp from 'sharp'
import { DOMParser } from '@xmldom/xmldom'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { createBlankFlowCourseProject } from '../../src/renderer/project/createFlowCourseProject'
import { createBlankSpatialCourseProject } from '../../src/renderer/project/createSpatialCourseProject'
import { createTextNode } from '../../src/core/tools/nativeNodeFactories'
import { sceneNodeToCourseLayerItem } from '../../src/shared/courseProjectModel'
import { buildPublishedCourseV2Payload } from '../../src/renderer/export/course/buildPublishedCourse'
import type { CompositionLayerItem, CourseProjectDocument } from '../../src/shared/courseProjectTypes'

let browser: Browser
let bundle: string
beforeAll(async () => {
  bundle = (await build({
    stdin: { contents: `
      export {buildCoursePptx} from './src/renderer/export/course/buildCoursePptx';
      export {buildCoursePrintArtifacts} from './src/renderer/export/course/buildCoursePrintArtifacts';
      export {buildFlowDocx} from './src/renderer/export/course/flowDocx';
      export {captureFlowCompositionPictures} from './src/renderer/export/course/flowCompositionPictures';
      export {resolveFlowDocxPageBox} from './src/renderer/export/course/flowDocxProjection';
      export {SpatialSurfaceHost} from './src/player/surfaces/spatial/SpatialSurfaceHost';
      export {waitForPublishedObservationReady} from './src/player/surfaces/publishedCapture';
    `, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, format: 'iife', globalName: 'CompositionExports', platform: 'browser',
    define: { 'process.env.NODE_ENV': '"test"' },
  })).outputFiles[0]!.text
  browser = await chromium.launch({ headless: true })
}, 30_000)
afterAll(async () => { await browser?.close() })

function web(id: string, width: number, height: number, css: string): CompositionLayerItem {
  return {
    layerItemId: id, kind: 'composition', label: id, locked: false,
    order: 2, visible: true, rotation: 0, opacity: 1, hitPolicy: 'auto', playbackInitialVisibility: 'inherit',
    frame: { mode: 'absolute', x: 0, y: 0, width, height },
    content: { assets: {}, doctype: 'html', root: { id: 'html', kind: 'element', tagName: 'html', attributes: {}, children: [
      { id: 'head', kind: 'element', tagName: 'head', attributes: {}, children: [
        { id: 'style', kind: 'element', tagName: 'style', attributes: {}, children: [
          { id: 'css', kind: 'text', text: `html,body{margin:0;font:24px Arial}main{width:100%;height:${height}px;box-sizing:border-box;padding:24px}${css}` },
        ] },
      ] },
      { id: 'body', kind: 'element', tagName: 'body', attributes: {}, children: [
        { id: 'main', kind: 'element', tagName: 'main', attributes: {}, children: [
          { id: 'text', kind: 'text', text: 'Actual Web composition' },
        ] },
      ] },
    ] } },
  }
}

function publish(project: CourseProjectDocument) {
  return buildPublishedCourseV2Payload({ project, assetFiles: {}, components: {} })
}
function xml(bytes: Uint8Array) { return new DOMParser().parseFromString(strFromU8(bytes), 'application/xml') }
function textShape(bytes: Uint8Array, text: string) {
  const doc = xml(bytes)
  const shape = Array.from(doc.getElementsByTagName('p:sp')).find(element =>
    Array.from(element.getElementsByTagName('a:t')).some(node => node.textContent === text))!
  if (!shape) throw new Error(`Missing editable text ${text}`)
  const offset = shape.getElementsByTagName('a:off')[0]!, size = shape.getElementsByTagName('a:ext')[0]!
  const run = shape.getElementsByTagName('a:rPr')[0]!
  return { x: Number(offset.getAttribute('x')) / 9525, y: Number(offset.getAttribute('y')) / 9525,
    width: Number(size.getAttribute('cx')) / 9525, height: Number(size.getAttribute('cy')) / 9525,
    font: Number(run.getAttribute('sz')) / 100 }
}

it('keeps native text editable and scales shared geometry and font together; PDF keeps each actual scene size', async () => {
  const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
  const slide = project.surfaces.find(surface => surface.type === 'slide')!
  slide.canvas = { width: 1280, height: 720 }
  const first = slide.scenes[0]!
  first.canvas = { width: 720, height: 960 }
  const second = structuredClone(first)
  second.id = 'landscape'; second.name = 'Landscape'; second.canvas = { width: 1440, height: 720 }
  first.layerItems = [sceneNodeToCourseLayerItem(createTextNode({ id: 'local-first', text: 'Portrait local', x: 40, y: 100,
    width: 360, height: 60, style: { fontSize: 32 } }), 1)]
  const slideWeb = web('slide-card', 240, 120, 'main{background:#10b981;color:white}')
  slideWeb.frame.x = 400; slideWeb.frame.y = 800
  first.layerItems.push(slideWeb)
  second.layerItems = [sceneNodeToCourseLayerItem(createTextNode({ id: 'local-second', text: 'Landscape local', x: 100, y: 100,
    width: 600, height: 60, style: { fontSize: 40 } }), 1)]
  slide.scenes.push(second)
  slide.surfaceLayerItems = [{ item: sceneNodeToCourseLayerItem(createTextNode({ id: 'shared-title', text: 'Shared title', x: 160, y: 80,
    width: 400, height: 80, style: { fontSize: 48 } }), 0), visibility: { mode: 'all', locationIds: [] } }]
  const firstLocation = project.locations.find(location => location.surfaceId === slide.id && location.kind === 'slide-scene')!
  if (firstLocation.kind !== 'slide-scene') throw new Error('Missing Slide location')
  project.locations.push({ ...firstLocation, id: 'landscape-location', label: 'Landscape', sceneId: second.id })
  const published = publish(project)
  const page = await browser.newPage()
  try {
    await page.setContent('<body></body>'); await page.addScriptTag({ content: bundle })
    const result = await page.evaluate(async payload => {
      const api = (window as any).CompositionExports
      const pptx = await api.buildCoursePptx(payload)
      const print = await api.buildCoursePrintArtifacts(payload)
      return { bytes: Array.from(pptx.bytes) as number[], report: pptx.report,
        printReport: print.report, html: new TextDecoder().decode(print.files.find((file: any) => file.kind === 'pdf-html').bytes) }
    }, published)
    expect(result.report.filter((entry: any) => entry.severity === 'error')).toEqual([])
    expect(result.printReport.filter((entry: any) => entry.severity === 'error')).toEqual([])
    const parts = unzipSync(Uint8Array.from(result.bytes))
    const size = xml(parts['ppt/presentation.xml']!).getElementsByTagName('p:sldSz')[0]!
    expect(Number(size.getAttribute('cx')) / 9525).toBe(720)
    expect(Number(size.getAttribute('cy')) / 9525).toBe(960)
    expect(textShape(parts['ppt/slides/slide1.xml']!, 'Portrait local')).toMatchObject({ x: 40, y: 100, width: 360, font: 24 })
    expect(textShape(parts['ppt/slides/slide2.xml']!, 'Landscape local')).toMatchObject({ x: 50, y: 350, width: 300, font: 15 })
    const sharedPages = Object.entries(parts).filter(([name]) => /ppt\/(?:slides|slideMasters|slideLayouts)\/.*\.xml$/.test(name))
      .filter(([, bytes]) => strFromU8(bytes).includes('Shared title'))
    expect(sharedPages.map(([name]) => name)).toHaveLength(2)
    const sharedShapes = sharedPages.map(([, bytes]) => textShape(bytes, 'Shared title'))
    expect(sharedShapes[0]).toMatchObject({ x: 90, width: 225, font: 20.25 })
    expect(sharedShapes[0]!.y).toBeCloseTo(322.5, 3)
    expect(sharedShapes[1]).toMatchObject({ x: 120, y: 340, width: 200, font: 18 })
    const webPicture = Object.entries(parts).find(([name]) => /^ppt\/media\/.*\.png$/.test(name))!
    expect(webPicture).toBeDefined()
    const webPixels = await sharp(webPicture[1]).raw().toBuffer({ resolveWithObject: true })
    expect(webPixels.info).toMatchObject({ width: 240, height: 120 })
    const webIndex = (100 * webPixels.info.width + 120) * webPixels.info.channels
    expect(Array.from(webPixels.data.subarray(webIndex, webIndex + 3))).toEqual([16, 185, 129])
    expect(result.report.some((entry: any) => entry.layerItemId === 'slide-card' && entry.message.includes('实际播放器图面'))).toBe(true)
    expect(result.report.some((entry: any) => entry.message.includes('首个场景'))).toBe(true)
    await page.setContent(result.html)
    await page.locator('img').evaluateAll(images => Promise.all(images.map(image => (image as HTMLImageElement).decode())))
    const pdf = await PDFDocument.load(await page.pdf({ preferCSSPageSize: true, printBackground: true }))
    expect(pdf.getPages().map(p => p.getSize())).toEqual([{ width: 540, height: 720 }, { width: 1080, height: 540 }])
  } finally { await page.close() }
}, 30_000)

it('exports a Spatial Web region from the real Player image instead of a static SVG placeholder', async () => {
  const project = createBlankSpatialCourseProject({ includeDefaultController: false, controls: 'none' })
  const surface = project.surfaces.find(surface => surface.type === 'spatial-2d')!
  const item = web('world-card', 360, 240, 'main{background:#ec008c;color:white;border-radius:30px}')
  const body = item.content.root.kind === 'element' ? item.content.root.children[1] : undefined
  const main = body?.kind === 'element' ? body.children[0] : undefined
  if (main?.kind !== 'element') throw new Error('Missing Web main')
  main.children.push({ id: 'probe-region', kind: 'element', tagName: 'div', attributes: { style: 'height:50px' }, children: [
    { id: 'probe-runtime', kind: 'runtime', runtime: { protocol: 'surface-runtime', runtimeApiVersion: 3, renderMode: 'dom', enabled: true,
      source: `CoursewareRuntime.define({protocol:'surface-runtime',runtimeApiVersion:3,create(ctx){
        var probe=window.__spatialExportProbe={creates:1,destroys:0};
        var button=document.createElement('button');button.textContent='Count 0';var count=0;
        button.onclick=function(){button.textContent='Count '+(++count)};ctx.dom.root.append(button);
        return {destroy(){probe.destroys++;button.remove()}};
      }});`, content: { values: {} }, assets: {} } },
  ] })
  item.frame.x = -180; item.frame.y = -120
  surface.world.layerItems = [item]
  const page = await browser.newPage()
  try {
    await page.setContent('<body></body>'); await page.addScriptTag({ content: bundle })
    const result = await page.evaluate(async payload => {
      const api = (window as any).CompositionExports
      const pptx = await api.buildCoursePptx(payload)
      const container = document.createElement('div'); container.style.cssText = 'width:1120px;height:760px'; document.body.append(container)
      const host = api.SpatialSurfaceHost.fromPublishedCourse(payload, { width: 1120, height: 760 }, { staticCapture: true })
      await host.mount(container); await host.activate(); await api.waitForPublishedObservationReady(container)
      const iframe = container.querySelector<HTMLIFrameElement>('iframe[data-web-composition]')!
      const dom = iframe.contentDocument!, button = dom.querySelector<HTMLButtonElement>('button')!
      button.click()
      const probe = (iframe.contentWindow as any).__spatialExportProbe
      await host.capture({ purpose: 'export', width: 1120, height: 760 })
      const state = { sameIframe: iframe === container.querySelector('iframe[data-web-composition]'), sameDocument: dom === iframe.contentDocument,
        sameButton: button === dom.querySelector('button'), count: button.textContent, creates: probe.creates, destroysBeforeClose: probe.destroys }
      await host.destroy(); container.remove()
      return { bytes: Array.from(pptx.bytes) as number[], report: pptx.report, warnings: pptx.warnings, slideCount: pptx.slideCount,
        state: { ...state, destroysAfterClose: probe.destroys } }
    }, publish(project))
    expect(result.slideCount, JSON.stringify(result.report)).toBe(1)
    expect(result.report.filter((entry: any) => entry.severity === 'error')).toEqual([])
    expect(result.report.some((entry: any) => entry.message.includes('实际播放器图面'))).toBe(true)
    expect(result.warnings.some((message: string) => /占位|静态简化/.test(message))).toBe(false)
    expect(result.state).toEqual({ sameIframe: true, sameDocument: true, sameButton: true, count: 'Count 1', creates: 1, destroysBeforeClose: 0, destroysAfterClose: 1 })
    const parts = unzipSync(Uint8Array.from(result.bytes))
    const images = Object.entries(parts).filter(([name]) => /^ppt\/media\/.*\.png$/.test(name))
    expect(images).toHaveLength(1)
    const decoded = await sharp(images[0]![1]).raw().toBuffer({ resolveWithObject: true })
    expect(decoded.info).toMatchObject({ width: 1120, height: 760 })
    const index = (460 * decoded.info.width + 560) * decoded.info.channels
    expect(Array.from(decoded.data.subarray(index, index + 3))).toEqual([236, 0, 140])
    expect(strFromU8(parts['ppt/slides/slide1.xml']!)).toContain('<p:pic>')
  } finally { await page.close() }
}, 30_000)

it('keeps Flow body text editable and carries every readable Web picture segment into real DOCX and PDF', async () => {
  const project = createBlankFlowCourseProject({ includeDefaultController: false, controls: 'none' })
  const surface = project.surfaces.find(surface => surface.type === 'flow')!
  const block = surface.blocks[0]!
  if (block.type !== 'heading' && block.type !== 'paragraph') throw new Error('Missing first text block')
  block.content = { inlines: [{ type: 'text', text: 'Editable body before the Web region' }] }
  const item = web('long-flow-card', 600, 2100,
    'main{background:linear-gradient(to bottom,#ef4444 0px,#ef4444 700px,#22c55e 700px,#22c55e 1400px,#3b82f6 1400px,#3b82f6 2100px);color:white}')
  item.paperSpace = 'paper'
  surface.surfaceLayerItems = [{ item, visibility: { mode: 'all', locationIds: [] }, bodyPlane: 'overlay',
    paragraphAnchor: { blockId: block.id, offsetY: 0, xRatio: 0 } }]
  const page = await browser.newPage()
  try {
    await page.setContent('<body></body>'); await page.addScriptTag({ content: bundle })
    const result = await page.evaluate(async payload => {
      const output = await (window as any).CompositionExports.buildCoursePrintArtifacts(payload)
      return { report: output.report, warnings: output.warnings,
        docx: Array.from(output.files.find((file: any) => file.kind === 'docx').bytes) as number[],
        html: new TextDecoder().decode(output.files.find((file: any) => file.kind === 'pdf-html').bytes) }
    }, publish(project))
    expect(result.report.filter((entry: any) => entry.severity !== 'info')).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.report.some((entry: any) => entry.message.includes('3 段图片'))).toBe(true)
    expect(result.report.some((entry: any) => entry.message.includes('浮层不进入'))).toBe(false)
    const parts = unzipSync(Uint8Array.from(result.docx))
    const documentXml = xml(parts['word/document.xml']!)
    expect(strFromU8(parts['word/document.xml']!)).toContain('<w:t>Editable body before the Web region</w:t>')
    expect(documentXml.getElementsByTagName('wp:inline')).toHaveLength(3)
    expect(Array.from(documentXml.getElementsByTagName('w:br')).filter(br => br.getAttribute('w:type') === 'page')).toHaveLength(2)
    const media = Object.entries(parts).filter(([name]) => /^word\/media\/image\d+\.png$/.test(name))
    expect(media).toHaveLength(3)
    const finalImage = await sharp(media[2]![1]).raw().toBuffer({ resolveWithObject: true })
    expect(finalImage.info.width).toBe(600)
    expect(finalImage.info.height).toBeGreaterThan(100)
    expect(Array.from(finalImage.data.subarray(finalImage.info.channels * 50, finalImage.info.channels * 50 + 3))).toEqual([59, 130, 246])
    const extents = Array.from(documentXml.getElementsByTagName('wp:extent'))
    for (let i = 0; i < extents.length; i++) {
      const metadata = await sharp(media[i]![1]).metadata()
      expect(Number(extents[i]!.getAttribute('cx')) / Number(extents[i]!.getAttribute('cy'))).toBeCloseTo(metadata.width! / metadata.height!, 2)
    }
    await page.setContent(result.html)
    await page.locator('img').evaluateAll(images => Promise.all(images.map(image => (image as HTMLImageElement).decode())))
    const images = await page.locator('figure[data-flow-print="image"] img').evaluateAll(nodes => nodes.map(image => {
      const img = image as HTMLImageElement
      return { width: img.clientWidth, height: img.clientHeight, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight }
    }))
    expect(images).toHaveLength(3)
    expect(images[0]!.width).toBe(600)
    expect(images[0]!.height).toBeGreaterThan(900)
    const pdf = await PDFDocument.load(await page.pdf({ preferCSSPageSize: true, printBackground: true }))
    // The editable title and body use the first sheet; each Web segment stays
    // readable on its own following sheet rather than compressing all three.
    expect(pdf.getPageCount()).toBe(4)
    let imagePages = 0
    for (const pdfPage of pdf.getPages()) {
      const resources = pdfPage.node.Resources()!
      const xObjects = resources.lookupMaybe(PDFName.of('XObject'), PDFDict)
      if (xObjects?.keys().length) imagePages++
    }
    expect(imagePages).toBe(3)
  } finally { await page.close() }
}, 30_000)
