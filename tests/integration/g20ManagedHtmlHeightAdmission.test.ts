// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest'
import { build } from 'esbuild'
import { chromium, type Browser } from 'playwright'
import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { addCourseFlowPage } from '../../src/core/tools/courseLocations'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { ControlledBuildService } from '../../src/main/workbench/build/ControlledBuildService'
import { createDocumentJournal } from '../../src/main/workbench/documentJournal'
import { HtmlImportService } from '../../src/main/workbench/htmlImport/HtmlImportService'
import { createHtmlDocumentRuntimeSource } from '../../src/shared/runtime/htmlDocumentSource'

let browser: Browser
let bundle: string
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `export {mountPublishedSurfaceRuntime,createPublishedSurfaceRuntimeSession} from './src/player/surfaces/runtime/publishedSurfaceRuntimeMount'`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife', globalName: 'HeightAdmission', platform: 'browser', define: { 'process.env.NODE_ENV': '"test"' } })).outputFiles[0]!.text
  browser = await chromium.launch({ headless: true })
}, 15000)
afterAll(async () => { await browser?.close() })

const centeredPage = '<!doctype html><style>html,body{margin:0;height:100vh;overflow:hidden}body{display:flex;align-items:center;justify-content:center}</style><button>Continue</button>'

const clippedPage = '<!doctype html><style>body{margin:0}main{position:absolute;width:200px;height:200px}@media(max-height:500px){main{clip:rect(0,200px,1px,0)}}</style><main>Continue</main>'
const backgroundPage = `<html><style>body{margin:0}main{width:200px;height:200px;background-image:url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22200%22%3E%3Crect width=%22200%22 height=%22200%22 fill=%22red%22/%3E%3C/svg%3E");background-repeat:no-repeat}@media(max-height:500px){main{background-position-y:-199px}}</style><main></main></html>`

async function observe(source: string) {
  const page = await browser.newPage()
  try {
    await page.route('https://height-admission.invalid/**', route => route.fulfill({ contentType: 'text/html', body: '<div id="host" style="width:640px;height:700px"></div>' }))
    await page.route('https://height-admission.invalid/style.css', route => route.fulfill({ contentType: 'text/css', body: paintCss }))
    await page.goto('https://height-admission.invalid/')
    await page.addScriptTag({ content: bundle })
    return await page.evaluate(async source => {
      const api = (window as any).HeightAdmission
      const bytes = new Uint8Array(source.length * 2)
      for (let i = 0; i < source.length; i++) { bytes[i * 2] = source.charCodeAt(i) & 255; bytes[i * 2 + 1] = source.charCodeAt(i) >>> 8 }
      let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte)
      const session = api.createPublishedSurfaceRuntimeSession()
      const heights: number[] = []
      const beforeResize: string[] = []
      let handle: any
      handle = api.mountPublishedSurfaceRuntime(document.getElementById('host'), { instanceId: 'admission', runtime: { protocol: 'surface-runtime', runtimeApiVersion: 3, enabled: true, renderMode: 'dom', code: { encoding: 'base64-utf16le', data: btoa(binary) }, content: { values: {} }, assets: {} }, width: 640, height: 700, visible: true, session, resolveAsset: () => undefined, onContentHeightChange: (height: number) => { beforeResize.push(document.querySelector('iframe')?.contentDocument?.body.innerHTML ?? 'missing'); heights.push(height); handle.updateSize(640, height) } })
      let observationFailure = '', captureFailure = ''
      try { await handle.waitForObservationReady() } catch (error) { observationFailure = String(error) }
      try { await handle.waitForCaptureReady() } catch (error) { captureFailure = String(error) }
      const result = { beforeResize, heights, ok: handle.ok, observationFailure, captureFailure, mirrors: document.querySelectorAll('[data-html-height-measurement]').length }
      handle.destroy(); session.destroy()
      return result
    }, source)
  } finally { await page.close() }
}

it.each([
  centeredPage,
  clippedPage,
  backgroundPage,
  centeredPage.replace('<button>Continue</button>', 'Continue'),
  centeredPage.replace('body{display:flex;', 'body{font-size:6vh;display:flex;'),
  centeredPage.replace('</style><button>Continue</button>', 'body::before{content:"Continue"}</style>'),
])('rejects a viewport page whose mathematically stable height clips or shrinks its real content', async html => {
  const result = await observe(createHtmlDocumentRuntimeSource({ html, resourceKeys: [] }))
  expect(result.ok).toBe(false)
  expect(result.heights).toEqual([])
  expect(result.observationFailure).toContain('裁切')
  expect(result.captureFailure).toContain('裁切')
  expect(result.mirrors).toBe(0)
})

it.each([centeredPage, clippedPage, backgroundPage])('propagates the real Chromium rejection through ControlledBuild admission with zero formal writes', async html => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-height-admission-'))
  try {
    const blank = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
    const project = addCourseFlowPage(blank, { expectedRevision: blank.revision }).project
    const driver = new CourseV9Driver()
    const registry = new DocumentRegistry({ persistence: createDocumentJournal({ directory: path.join(root, 'journal') }), drivers: [driver], createId: randomUUID, bindingKey: binding => binding.path })
    const session = await registry.create({ kind: 'course-v9', project, resources: { assets: {}, components: {} } }, 'height.h5lesson')
    let actualRejection = ''
    const builds = new ControlledBuildService({ directory: path.join(root, 'builds'), admission: { async run(payload) {
      const surface = payload.project.surfaces.find(surface => surface.type === 'flow')!
      const runtime = surface.surfaceLayerItems.find(entry => entry.item.kind === 'runtime')!.item
      if (runtime.kind !== 'runtime') throw new Error('Expected actual Flow runtime')
      const result = await observe(runtime.runtime.source)
      expect(result.heights).toEqual([])
      expect(result.ok).toBe(false)
      actualRejection = result.observationFailure
      return { ok: false, message: actualRejection }
    } } })
    const gateway = new DocumentToolGateway(registry, [driver], randomUUID, { services: { builds } })
    await gateway.beginRun({ runId: 'height', actor: 'human', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
    const targetHandle = await gateway.issueTarget('height', session.documentId, { kind: 'document' })
    const service = new HtmlImportService({ session, gateway })
    const sourcePath = path.join(root, 'viewport.html')
    await fs.writeFile(sourcePath, html)
    const before = session.read()
    const ticket = await service.prepare({ operationId: 'viewport', runId: 'height', targetHandle, sourcePath, locationId: project.locations.find(location => location.kind === 'flow-block')!.id })
    await expect(service.admit(ticket)).rejects.toThrow('未通过')
    expect(actualRejection).toContain('裁切')
    await expect(service.commit(ticket)).rejects.toThrow('尚未通过')
    expect(session.read().revision).toBe(before.revision)
    expect(session.read().undoDepth).toBe(before.undoDepth)
    expect(session.read().model).toEqual(before.model)
    const logs = await builds.execute('height', { type: 'logs', jobId: ticket.jobId }) as { entries: Array<{ stage: string; level: string; message: string }> }
    expect(logs.entries.some(entry => entry.stage === 'admission' && entry.level === 'error' && entry.message.includes('裁切'))).toBe(true)
  } finally {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected fixture root')
    await fs.rm(root, { recursive: true, force: true })
  }
}, 20000)


it('quarantines author resize handlers that erase content before claiming readiness', async () => {
  const html = '<!doctype html><style>body{margin:0}main{height:200px}</style><main>Continue</main><script>addEventListener("resize",()=>{if(innerHeight<500)document.querySelector("main").textContent=""})</script>'
  const result = await observe(createHtmlDocumentRuntimeSource({ html, resourceKeys: [] }))
  expect(result.heights).toEqual([200])
  expect(result.beforeResize[0]).toContain('Continue')
  expect(result.ok).toBe(false)
  expect(result.observationFailure).toContain('改变了正文')
  expect(result.captureFailure).toContain('改变了正文')
  expect(result.mirrors).toBe(0)
})


const paintCss = 'body,p{margin:0}main{height:200px}img{display:block;width:200px;height:180px;object-fit:cover;object-position:0% 50%}p{font-family:monospace;height:20px}'
const redImage = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="180"><rect width="200" height="180" fill="red"/><rect x="200" width="200" height="180" fill="blue"/></svg>')}`
const greenImage = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="180"><rect width="400" height="180" fill="green"/></svg>')}`

it.each([
  ['object position', 'document.querySelector("img").style.objectPosition="100% 50%"', false],
  ['same-size srcset', `document.querySelector("img").srcset=${JSON.stringify(greenImage + ' 1x')}`, false],
  ['text transform', 'document.querySelector("p").style.textTransform="uppercase"', false],
  ['direct CSSOM', 'document.styleSheets[0].insertRule("img{object-position:100% 50%}",document.styleSheets[0].cssRules.length)', false],
  ['external CSSOM', 'document.styleSheets[0].insertRule("p{text-transform:uppercase}",document.styleSheets[0].cssRules.length)', true],
])('refuses resized content paint changes: %s', async (_name, mutation, external) => {
  const css = external ? '<link rel="stylesheet" href="https://height-admission.invalid/style.css">' : `<style>${paintCss}</style>`
  const html = `<!doctype html>${css}<main><img src="${redImage}"><p>continue</p></main><script>addEventListener('resize',()=>{if(innerHeight<500){${mutation}}})</script>`
  const result = await observe(createHtmlDocumentRuntimeSource({ html, resourceKeys: [] }))
  expect(result.heights).toEqual([200])
  expect(result.beforeResize[0]).toContain('continue')
  expect(result.ok).toBe(false)
  expect(result.observationFailure).toMatch(/改变了正文|动态修改样式表/)
  expect(result.captureFailure).toMatch(/改变了正文|动态修改样式表/)
  expect(result.mirrors).toBe(0)
})
