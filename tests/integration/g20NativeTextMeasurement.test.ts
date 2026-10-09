// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildSync } from 'esbuild'
import { chromium } from 'playwright'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'
import { plainDocumentText } from '../../src/shared/document/content'
import type { DocumentModel, DocumentOperation } from '../../src/shared/workbench/document'
import { createNamedSelectionFixture } from '../helpers/g20NamedSelectionFixture'
import { prepareNativeTextFrame, type AsyncNativeTextMeasurePort } from '../../src/core/tools/prepareNativeTextFrame'
import { prepareNativeLayerTextMeasurement } from '../../src/core/tools/nativeTextLayout'
import { layerToolContext } from '../../src/core/tools/layerEditing'
import { patchEffectiveLayerPropertiesAtTarget } from '../../src/core/tools/layerProperties'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { buildSlideEditorView } from '../../src/core/tools/slideLayerView'

function fixture() {
  const f = createNamedSelectionFixture(), item = f.scene.layerItems[0]
  if (item.kind !== 'native' || item.content.nativeType !== 'text') throw new Error('text fixture')
  item.content.data.style.overflow = 'auto-height'; item.frame.width = 120
  return { ...f, item }
}

it('prepares the exact effective named text/runs/font once, rejects mismatches/fallback and keeps explicit or unnecessary sizing synchronous', async () => {
  const f = fixture(), target = { kind: 'course-object' as const, locationId: f.locationId, itemId: 'scene-text', stateId: 'named-a' }
  const context = layerToolContext(f.model.project, target)
  const patch = { nativeTextStyle: { fontFamily: '"Noto Sans SC"', fontSize: 48 }, nativeData: { text: '中文😀增长', runs: [{ start: 0, end: 2, style: { fontSize: 60 } }], style: { bold: true } } }
  const measure = vi.fn<AsyncNativeTextMeasurePort>(async () => ({ measurementMode: 'browser-canvas', requiredWidth: 120, requiredHeight: 187.5 }))
  const port = await prepareNativeTextFrame(context.entry.item, patch, measure)
  expect(measure).toHaveBeenCalledTimes(1)
  expect(measure.mock.calls[0][0]).toMatchObject({ width: 120, axis: 'height', node: { x: 160, text: '中文😀增长', style: { fontFamily: '"Noto Sans SC"', fontSize: 48, bold: true }, runs: patch.nativeData.runs } })
  const planned = patchEffectiveLayerPropertiesAtTarget(f.model.project, context.command, patch, { expectedRevision: 0, measureTextFrame: port })
  expect(planned.ok).toBe(true)
  const effective = buildSlideEditorView({ project: planned.nextDocument!, locationId: f.locationId, stateId: 'named-a' }).layers.find(layer => layer.selectionId === 'scene-text')!.item
  expect(effective).toMatchObject({ frame: { width: 120, height: 187.5 }, content: { data: { text: '中文😀增长' } } })
  expect(f.item.frame.height).toBe(90)
  expect(() => port(context.entry.item, { ...patch, frame: { width: 121 } })).toThrow('已改变')
  await expect(prepareNativeTextFrame(context.entry.item, patch)).rejects.toMatchObject({ code: 'unsupported-measurement' })
  await expect(prepareNativeTextFrame(context.entry.item, patch, async () => ({ measurementMode: 'deterministic-fallback' as 'browser-canvas', requiredWidth: 120, requiredHeight: 42 }))).rejects.toMatchObject({ code: 'unsupported-measurement' })
  const explicit = { ...patch, frame: { height: 77 } }
  expect(prepareNativeLayerTextMeasurement(context.entry.item, explicit)).toBeNull()
  expect((await prepareNativeTextFrame(context.entry.item, explicit))(context.entry.item, explicit)).toEqual({})
  const driver = new CourseV9Driver()
  expect(driver.apply(f.model, { type: 'course.object.patch', locationId: f.locationId, itemId: 'scene-text', patch: { frame: { x: 125 } } })).not.toBeInstanceOf(Promise)
  expect(() => driver.apply(f.model, { type: 'course.object.patch', locationId: f.locationId, itemId: 'scene-text', patch })).toThrow('真实字体测量')
})

it('uses current AI presentation growth and the real GUI measured-frame writer, preserves layout after reopen, and retires late font work', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'native-text-current-')), browser = await chromium.launch({ headless: true })
  try {
    const driver = new CourseV10Driver(), registry = new DocumentRegistry({ drivers: [driver], createId: randomUUID, bindingKey: binding => binding.path,
      persistence: { async append() {}, async save(input) { if (input.binding.kind !== 'file') throw Error('File required'); await fs.writeFile(input.binding.path, input.bytes); return { ...input.binding, version: `revision-${input.revision}` } } } })
    const project = createBlankCourseProjectV10('真实文字测量'); project.global = { underlay: [], overlay: [] }; project.instances = {}; project.definitions = { [TEXT_DEFINITION.id]: TEXT_DEFINITION }
    project.surfaces = [{ id: 'slide', kind: 'slide', title: '文字布局', childIds: ['text', 'neighbor'], designSize: { width: 800, height: 720 } }]
    const data = createTextComponentData('原始短正文'); data.appearance.fontFamily = 'sans-serif'; data.appearance.fontSize = 24; data.appearance.padding = 0
    project.instances.text = { id: 'text', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(data)), frame: { width: 120, height: 90, transform: [1, 0, 0, 1, 160, 100] } }
    project.instances.neighbor = { id: 'neighbor', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextComponentData('人工邻居'))), frame: { width: 140, height: 90, transform: [1, 0, 0, 1, 420, 100] } }
    const model = { kind: 'course-v10' as const, project, resources: { assets: {}, components: {} } }, session = await registry.create(model, 'measurement.glx'), gateway = new DocumentToolGateway(registry, [driver], randomUUID)
    await gateway.beginRun({ runId: 'measure', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
    const target = await gateway.issueTarget('measure', session.documentId, { kind: 'course-instance', surfaceId: 'slide', instanceId: 'text' })
    const aiText = '根据中文和😀的真实换行观察内容向下增长，人工位置与邻居都保持不变。'
    expect(await gateway.execute('measure', 'first', { name: 'text.replace', input: { target, content: aiText } })).toMatchObject({ kind: 'document-operation', result: { status: 'applied', revision: 1 } })
    const afterAi = session.read(); expect(afterAi.undoDepth).toBe(1)
    // Current AI owns content; grow-height is measured presentation, with the authored frame as its minimum.
    expect((afterAi.model as typeof model).project.instances.text.frame).toEqual(project.instances.text.frame)
    const bundle = buildSync({ stdin: { contents: "export * from './tests/helpers/currentCourseBrowserHarness'", resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, format: 'iife', globalName: 'CurrentCourse', platform: 'browser',
      loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl' }, define: { 'process.env.NODE_ENV': '"test"' } }).outputFiles[0].text
    const page = await browser.newPage({ viewport: { width: 1100, height: 850 } }), errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
    await page.route('http://localhost/native-measurement', route => route.fulfill({ contentType: 'text/html', body: '<main id="host" style="width:920px;height:760px;display:grid;position:relative"></main>' }))
    await page.goto('http://localhost/native-measurement')
    await page.exposeFunction('courseRead', () => session.read())
    await page.exposeFunction('courseDispatch', (operation: DocumentOperation) => session.execute(operation))
    await page.exposeFunction('courseLookup', (id: string) => session.lookupOperation(id))
    await page.addStyleTag({ content: (await fs.readFile('src/renderer/styles/globals.css', 'utf8')).replace("@import './variables.css';", await fs.readFile('src/renderer/styles/variables.css', 'utf8')) })
    await page.addScriptTag({ content: bundle })
    await page.evaluate(async () => {
      const w = window as any, api = { bootstrapCourse: w.courseRead, read: w.courseRead, dispatch: w.courseDispatch, lookup: (_document: string, id: string) => w.courseLookup(id), subscribe: () => () => {} }
      w.desktopAPI = { documents: api }; w.__courseHarness = await w.CurrentCourse.mountCurrentCourseBrowserHarness(document.getElementById('host'), api)
      await document.fonts.ready
    })
    const text = page.locator('[data-component-instance="text"] [data-text-component]')
    await text.waitFor({ state: 'visible' })
    const aiPresentation = await text.evaluate(element => ({ height: Number.parseFloat(getComputedStyle(element).height), width: Number.parseFloat(getComputedStyle(element).width), text: element.textContent }))
    expect(aiPresentation.text).toBe(aiText); expect(aiPresentation.height).toBeGreaterThan(90)
    const authoredBox = await page.locator('[data-component-instance="text"]').evaluate(element => ({ height: (element as HTMLElement).style.height, transform: (element as HTMLElement).style.transform }))
    expect(authoredBox.height).toBe('90px'); expect(authoredBox.transform).toBe('matrix(1, 0, 0, 1, 160, 100)')
    const coldMount = (model: Extract<DocumentModel, { kind: 'course-v10' }>) => page.evaluate(async (model: unknown) => {
      const host = document.createElement('div'); host.style.cssText = 'width:800px;height:720px;position:relative'; document.body.append(host)
      const player = (window as any).CurrentCourse.mountV10Model({ root: host, model, runScopeId: 'cold-measured' }); await player.ready; await document.fonts.ready
      const text = host.querySelector('[data-text-component]')!
      const outer = host.querySelector<HTMLElement>('[data-component-object="text"]')!
      const neighbor = host.querySelector<HTMLElement>('[data-component-object="neighbor"]')!
      const result = { height: text.getBoundingClientRect().height, text: text.textContent, outerHeight: outer.style.height, width: outer.style.width, transform: outer.style.transform, neighborTransform: neighbor.style.transform }; await player.dispose(); host.remove(); return result
    }, model as unknown)
    const filename = path.join(directory, 'measurement.glx')
    await registry.save(session.documentId, { kind: 'file', path: filename, version: null, bindingVersion: 0 })
    const aiReopened = driver.load(new Uint8Array(await fs.readFile(filename)))
    if (aiReopened.kind !== 'course-v10') throw Error('Current reopened AI course required')
    expect(aiReopened).toEqual(session.read().model)
    const aiCold = await coldMount(aiReopened)
    expect(aiCold.text).toBe(aiText); expect(aiCold.height).toBeGreaterThan(90); expect(aiCold.height).toBeCloseTo(aiPresentation.height, 2)
    expect(aiCold).toMatchObject({ outerHeight: '90px', width: '120px', transform: 'matrix(1, 0, 0, 1, 160, 100)', neighborTransform: 'matrix(1, 0, 0, 1, 420, 100)' })
    // The real professional editor measures browser fonts and the original slice captures data+frame in one transaction.
    await page.evaluate(() => (window as any).CurrentCourse.useEditorStore.getState().beginSlideDataEdit('text'))
    const editor = page.locator('[data-component-professional-editor] .ProseMirror'), guiText = aiText + ' 再由教师编辑并保存真实测量得到的外框高度。'
    await editor.waitFor({ state: 'visible' }); await editor.fill(guiText)
    await expect.poll(() => page.evaluate(() => (window as any).CurrentCourse.useEditorStore.getState().slideContentEdit?.frame?.height ?? 0)).toBeGreaterThan(90)
    const measuredHeight = await page.evaluate(() => (window as any).CurrentCourse.useEditorStore.getState().slideContentEdit.frame.height)
    expect(session.read().revision).toBe(afterAi.revision)
    await editor.press('Control+Enter')
    await expect.poll(() => session.read().revision).toBe(afterAi.revision + 1)
    const afterGui = session.read(), current = (afterGui.model as typeof model).project
    expect(afterGui.undoDepth).toBe(2); expect(current.instances.text.frame).toEqual({ ...project.instances.text.frame!, height: measuredHeight })
    expect(plainDocumentText((current.instances.text.data as unknown as typeof data).content)).toBe(guiText)
    expect(current.instances.neighbor).toEqual(project.instances.neighbor)
    await registry.save(session.documentId)
    const reopened = driver.load(new Uint8Array(await fs.readFile(filename))); expect(reopened).toEqual(session.read().model)
    if (reopened.kind !== 'course-v10') throw Error('Current reopened course required')
    const cold = await coldMount(reopened)
    expect(cold.text).toBe(guiText); expect(cold.height).toBeGreaterThanOrEqual(measuredHeight)
    expect(cold).toMatchObject({ outerHeight: `${measuredHeight}px`, width: '120px', transform: 'matrix(1, 0, 0, 1, 160, 100)', neighborTransform: 'matrix(1, 0, 0, 1, 420, 100)' })
    // Font readiness is delayed, never its actual measurement. Retiring the actual scope revokes that late callback.
    const late = await page.evaluate(async (payload: unknown) => {
      const model = payload as { project: { instances: Record<string, unknown>; definitions: Record<string, unknown> } }
      const w = window as any, original = Object.getOwnPropertyDescriptor(document.fonts, 'ready'); let release!: () => void
      Object.defineProperty(document.fonts, 'ready', { configurable: true, value: new Promise<void>(resolve => { release = resolve }) })
      const root = document.createElement('div'); root.style.cssText = 'position:absolute;width:120px;height:90px'; document.body.append(root)
      const events: unknown[] = [], host = new w.CurrentCourse.ComponentRuntimeHost({ resolveImplementation: () => w.CurrentCourse.textRuntimeImplementation,
        ports: () => ({ target: () => null, state: { get: () => undefined, set() {}, subscribe: () => () => {} }, events: { emit: (name: string, value: unknown) => events.push({ name, value }), subscribe: () => () => {} } }) })
      try {
        await host.sync({ runScopeId: 'late-font', instance: model.project.instances.text, definition: model.project.definitions['guoling.text'], root })
        const before = events.length; await host.disposeScope('late-font'); release(); await Promise.resolve(); await Promise.resolve()
        return { before, after: events.length, children: root.childNodes.length }
      } finally { if (original) Object.defineProperty(document.fonts, 'ready', original); else delete (document.fonts as any).ready; root.remove() }
    }, reopened as unknown)
    expect(late.before).toBeGreaterThan(0); expect(late.after, JSON.stringify(late)).toBe(late.before); expect(late.children).toBe(0)
    const beforeStale = session.read()
    expect(await gateway.execute('measure', 'stale-after-teacher', { name: 'text.replace', input: { target, content: '不得覆盖人工正文' } })).toMatchObject({ kind: 'error', code: 'target-conflict' })
    expect(session.read()).toEqual(beforeStale)
    await gateway.stop('measure')
    const stopped = session.read()
    expect(await gateway.execute('measure', 'late', { name: 'text.replace', input: { target, content: '不得落盘的迟到文字' } })).toMatchObject({ kind: 'error', code: 'run-stopped' })
    expect(session.read()).toEqual(stopped); expect(errors).toEqual([])
    await page.evaluate(async () => (window as any).__courseHarness.dispose())
  } finally { await browser.close(); await fs.rm(directory, { recursive: true, force: true }) }
}, 45_000)
