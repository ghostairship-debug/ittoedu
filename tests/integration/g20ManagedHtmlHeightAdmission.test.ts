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

async function observe(source: string) {
  const page = await browser.newPage()
  try {
    await page.setContent('<div id="host" style="width:640px;height:700px"></div>')
    await page.addScriptTag({ content: bundle })
    return await page.evaluate(async source => {
      const api = (window as any).HeightAdmission
      const bytes = new Uint8Array(source.length * 2)
      for (let i = 0; i < source.length; i++) { bytes[i * 2] = source.charCodeAt(i) & 255; bytes[i * 2 + 1] = source.charCodeAt(i) >>> 8 }
      let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte)
      const session = api.createPublishedSurfaceRuntimeSession()
      const heights: number[] = []
      let handle: any
      handle = api.mountPublishedSurfaceRuntime(document.getElementById('host'), { instanceId: 'admission', runtime: { protocol: 'surface-runtime', runtimeApiVersion: 3, enabled: true, renderMode: 'dom', code: { encoding: 'base64-utf16le', data: btoa(binary) }, content: { values: {} }, assets: {} }, width: 640, height: 700, visible: true, session, resolveAsset: () => undefined, onContentHeightChange: (height: number) => { heights.push(height); handle.updateSize(640, height) } })
      let observationFailure = '', captureFailure = ''
      try { await handle.waitForObservationReady() } catch (error) { observationFailure = String(error) }
      try { await handle.waitForCaptureReady() } catch (error) { captureFailure = String(error) }
      const result = { heights, ok: handle.ok, observationFailure, captureFailure, mirrors: document.querySelectorAll('[data-html-height-measurement]').length }
      handle.destroy(); session.destroy()
      return result
    }, source)
  } finally { await page.close() }
}

it.each([
  centeredPage,
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

it('propagates the real Chromium rejection through ControlledBuild admission with zero formal writes', async () => {
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
    await fs.writeFile(sourcePath, centeredPage)
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
