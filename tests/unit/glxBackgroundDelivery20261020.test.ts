// @vitest-environment node
import { build } from 'esbuild'
import { chromium, type Frame } from '@playwright/test'
import { JSDOM } from 'jsdom'
import { expect, it } from 'vitest'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { prepareComponentLibraryInsertion } from '../../src/core/components/library'
import { builtInWorkAsset } from '../../src/core/components/library/workAssets'
import { INPUT_DEFINITION, createInputData } from '../../src/components/input/data'
import { INTERACTIONS_DEFINITION } from '../../src/shared/componentInteractionData'
import type { ComponentEdit } from '../../src/shared/contracts/component-platform/operations'
import type { CourseProjectV11, JsonValue } from '../../src/shared/contracts/component-platform/project'
import type { DocumentPersistence } from '../../src/shared/workbench/document'
import { buildPublishedCourseV4 } from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import { compileCoursePlayback } from '../../src/core/publish/componentPlatform/compileCoursePlayback'
import { buildCompiledSingleHtml } from '../../src/core/publish/componentPlatform/buildSingleHtml'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as JsonValue
const directory = join(process.cwd(), 'output/glx-work-containers-20261020/background-facts')
const phase = process.env.GLX_BACKGROUND_AUDIT_PHASE ?? 'verified'
let bundle: Promise<string> | undefined
const playerBundle = () => bundle ??= build({ stdin: { contents: `export {mountCompiledCourse} from './src/player/componentPlatform/compiledPlayer';
  export {mountPublishedCourseV4} from './src/player/componentPlatform/publishedPlayer';`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, platform: 'browser', target: 'es2022', format: 'iife', globalName: 'GLXBackground' })
  .then(result => result.outputFiles[0]!.text)

function work(): CourseProjectV11 {
  return { schemaVersion: 11, id: 'a07-background', revision: 0, title: '背景真实运行证据', rootIds: ['scene', 'away'], entry: { rootInstanceId: 'scene' },
    definitions: { slide: { id: 'slide', role: 'mixed', implementation: { kind: 'builtin', key: 'guoling.container.slide' } },
      [INPUT_DEFINITION.id]: INPUT_DEFINITION, [INTERACTIONS_DEFINITION.id]: INTERACTIONS_DEFINITION },
    instances: { scene: { id: 'scene', definitionId: 'slide', name: '背景与前景输入', data: {}, childIds: ['control'],
      container: { kind: 'slide', designSize: { width: 960, height: 640 } } },
    away: { id: 'away', definitionId: 'slide', name: '离开背景', data: {}, childIds: [], container: { kind: 'slide', designSize: { width: 960, height: 640 } } },
    control: { id: 'control', definitionId: INPUT_DEFINITION.id, data: json(createInputData({ label: '前景输入', submitLabel: '应用背景参数' })),
      frame: { width: 500, height: 170, transform: [1, 0, 0, 1, 70, 70] } } }, assets: {}, global: { underlay: [], overlay: [] } }
}

/** Observe real Canvas and browser rAF; every original method still executes. No runtime API is replaced. */
function installCanvasProbe() {
  const observed = new WeakSet<HTMLCanvasElement>()
  const pending = new Set<number>()
  const facts = { canvases: 0, paints: 0, arcs: 0, radius: 0, requested: 0, cancelled: 0 }
  const nativeGet = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: any[]) {
    if (this.getAttribute('aria-hidden') === 'true' && !observed.has(this)) { observed.add(this); facts.canvases++ }
    return Reflect.apply(nativeGet, this, args)
  } as typeof nativeGet
  const nativeFill = CanvasRenderingContext2D.prototype.fillRect
  CanvasRenderingContext2D.prototype.fillRect = function (this: CanvasRenderingContext2D, ...args: Parameters<typeof nativeFill>) {
    if (this.canvas.getAttribute('aria-hidden') === 'true') facts.paints++
    return Reflect.apply(nativeFill, this, args)
  }
  const nativeArc = CanvasRenderingContext2D.prototype.arc
  CanvasRenderingContext2D.prototype.arc = function (this: CanvasRenderingContext2D, ...args: Parameters<typeof nativeArc>) {
    if (this.canvas.getAttribute('aria-hidden') === 'true') { facts.arcs++; facts.radius = args[2] }
    return Reflect.apply(nativeArc, this, args)
  }
  const request = window.requestAnimationFrame.bind(window), cancel = window.cancelAnimationFrame.bind(window)
  window.requestAnimationFrame = callback => {
    let id = 0
    id = request(time => { pending.delete(id); callback(time) }); pending.add(id); facts.requested++; return id
  }
  window.cancelAnimationFrame = id => { pending.delete(id); facts.cancelled++; return cancel(id) }
  Object.defineProperty(window, '__a07BackgroundProbe', { value: () => ({ ...facts, pending: pending.size,
    activity: (window as any).__guolingRuntimeActivity ?? null }) })
}

async function pixels(frame: Frame, selector = 'canvas[aria-hidden="true"]') {
  return frame.locator(selector).evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext('2d')!, pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    let dark = 0
    for (let index = 0; index < pixels.length; index += 4) if (pixels[index] < 235 && pixels[index + 3] > 0) dark++
    return { width: canvas.width, height: canvas.height, dark }
  })
}
const probe = (frame: Frame) => frame.evaluate(() => (window as any).__a07BackgroundProbe())

it.each(['ambient', 'scene'] as const)('executes %s background in the real sandbox and cold exported HTML', async kind => {
  await mkdir(directory, { recursive: true })
  const prefix = join(directory, `${kind}.${phase}`), glx = `${prefix}.glx`
  const driver = new CourseV10Driver(), initial = work()
  const persistence: DocumentPersistence = { async append() {}, async save(input) {
    if (input.binding.kind !== 'file') throw new Error('The evidence must be saved to a real file')
    await writeFile(input.binding.path, input.bytes)
    return { ...input.binding, version: String((await stat(input.binding.path)).mtimeMs) }
  } }
  const session = await DocumentSession.create({ documentId: `a07-${kind}`, epoch: 'a07', model: { kind: 'course-v10', project: initial, resources: { assets: {}, components: {} } },
    binding: { kind: 'file', path: glx, version: 'new', bindingVersion: 1 } }, driver, persistence)
  const apply = async (edits: ComponentEdit[]) => {
    const snapshot = session.read()
    if (snapshot.model.kind !== 'course-v10') throw new Error('Expected the formal work')
    const result = await session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, operationId: crypto.randomUUID(), actor: 'human', baseRevision: snapshot.revision,
      mutation: { type: 'command', command: captureComponentOperation(snapshot.model.project, edits) } })
    expect(result.status).toBe('applied')
  }
  const insertion = prepareComponentLibraryInsertion(initial, builtInWorkAsset(`guoling.work.background.${kind}`)!, { container: { kind: 'instance', instanceId: 'scene' }, index: 0 })
  await apply(insertion.command.edits)
  const backgroundId = insertion.rootIds[0], inserted = session.read().model
  if (inserted.kind !== 'course-v10') throw new Error('Expected the inserted work')
  const background = inserted.project.instances[backgroundId], key = background.stateBindings?.energy ?? 'energy'
  const data = { ...(background.data as Record<string, JsonValue>), energy: 0, color: '#f0fdfa', accent: '#000000' }
  const logic = structuredClone(inserted.project.logic ?? { courseState: [], navigationGuards: [] })
  if (kind === 'scene') logic.courseState.find(declaration => declaration.key === key)!.defaultValue = 0
  logic.courseState.push({ key: 'foreground-value', valueType: 'number', defaultValue: 0 }, { key: 'foreground-valid', valueType: 'boolean', defaultValue: false })
  const control = createInputData({ label: '前景输入', submitLabel: '应用背景参数', answer: { type: 'number', stateKey: kind === 'scene' ? key : 'foreground-value', validityKey: 'foreground-valid', ruleFamilyRuleIds: [] } })
  const edits: ComponentEdit[] = [{ type: 'data.set', instanceId: backgroundId, path: [], value: data },
    { type: 'data.set', instanceId: 'control', path: [], value: json(control) }, { type: 'project.logic.set', logic }]
  if (kind === 'ambient') edits.push({ type: 'container.patch', instanceId: 'scene', patch: { presentation: { initialStateId: 'low', states: [
    { id: 'low', title: '低能量', overrides: {} }, { id: 'high', title: '高能量', overrides: { [backgroundId]: { data: { ...data, energy: 1 } } } }] } } },
  { type: 'instance.insert', container: { kind: 'instance', instanceId: 'scene' }, index: inserted.project.instances.scene.childIds!.length,
    instances: [{ id: 'rules', definitionId: INTERACTIONS_DEFINITION.id, data: json({ rules: [{ id: 'raise-energy', name: '原生输入驱动背景参数', enabled: true,
      trigger: { type: 'input.submit', nodeId: 'control' }, conditions: [], actions: [{ id: 'apply-energy', start: 'after-previous', delayMs: 0,
        action: { type: 'presentation.set', containerId: 'scene', stateId: 'high' } }] }] }), attachments: [{ instanceId: 'rules', target: { kind: 'instance', instanceId: 'scene' } }] }], rootIds: ['rules'] })
  await apply(edits)
  const saved = await session.save(), cold = driver.load(new Uint8Array(await readFile(glx)))
  if (cold.kind !== 'course-v10') throw new Error('Expected the cold GLX')
  expect(cold.project.instances[backgroundId].data).toEqual(data)
  expect(cold.project.instances[backgroundId].stateBindings).toEqual(background.stateBindings)
  const published = await buildPublishedCourseV4({ project: cold.project, assetBytes: cold.resources.assets, componentFiles: cold.resources.components }, {
    compilation: new InMemoryComponentCompilation(createEsbuildComponentCompiler()) })
  expect(published.diagnostics).toEqual([])
  await writeFile(`${prefix}.published.json`, JSON.stringify(published.payload, null, 2))
  const dom = new JSDOM('<!doctype html>')
  const artifact = await compileCoursePlayback(published.payload, { document: dom.window.document, renderBuiltin: async () => '' })
  dom.window.close()
  const bundle = await playerBundle(), escapedPayload = JSON.stringify(published.payload).replace(/</g, '\\u003c')
  const publishedFile = `${prefix}.published.html`, compiledFile = `${prefix}.compiled.html`
  await writeFile(publishedFile, `<!doctype html><meta charset="UTF-8"><style>html,body,#root{width:100%;height:100%;margin:0}</style><main id="root"></main><script>${bundle}</script>
    <script>window.reports=[];window.workPlayerReady=GLXBackground.mountPublishedCourseV4(${escapedPayload},document.getElementById('root'),{keyboardNavigation:false,report:m=>window.reports.push(m)}).then(p=>window.workPlayer=p);</script>`)
  await writeFile(compiledFile, buildCompiledSingleHtml(artifact, `${bundle};var CoursewareCompiledPlayer=GLXBackground;`))
  const browser = await chromium.launch({ headless: true }), facts: Record<string, unknown> = { kind, phase, backgroundId, stateKey: key, glx, savedRevision: saved.revision,
    sourceRetained: cold.project.definitions[cold.project.instances[backgroundId].definitionId].implementation, publishedSchema: published.payload.schemaVersion, modes: {} }
  let failure: unknown
  try {
    for (const mode of ['published', 'compiled'] as const) {
      const page = await browser.newPage({ viewport: { width: 1000, height: 700 } }), errors: string[] = []
      page.setDefaultTimeout(6_000); page.on('pageerror', error => errors.push(error.message)); await page.addInitScript(installCanvasProbe)
      const steps: Record<string, unknown> = { errors, html: mode === 'published' ? publishedFile : compiledFile }
      ;(facts.modes as Record<string, unknown>)[mode] = steps
      try {
        await page.goto(pathToFileURL(mode === 'published' ? publishedFile : compiledFile).href)
        await page.evaluate(async mode => { (window as any).workPlayer = await (mode === 'published' ? (window as any).workPlayerReady : (window as any).coursePlayerReady) }, mode)
        const host = mode === 'published' ? `[data-component-instance-id="${backgroundId}"]` : `[data-compiled-node="${backgroundId}"]`
        const iframe = page.locator(`${host} iframe`)
        const frame = await iframe.count() ? await (await iframe.elementHandle())!.contentFrame() : page.mainFrame()
        if (!frame) throw new Error('The actual background code environment is missing')
        const leaseName = frame.name(), iframeCount = await iframe.count()
        steps.carrier = { iframeCount, leaseName }
        if (mode === 'published') expect(iframeCount).toBe(1)
        await expect.poll(async () => (await probe(frame)).paints).toBeGreaterThan(2)
        const before = { probe: await probe(frame), pixels: await pixels(frame) }; steps.before = before
        expect(before.probe.radius).toBe(4); expect(before.pixels.dark).toBeGreaterThan(300)
        const input = page.getByRole('textbox', { name: '前景输入' }), submit = page.getByRole('button', { name: '应用背景参数' })
        await input.fill('1'); await submit.click()
        steps.nativeState = await page.evaluate(() => (window as any).workPlayer.runtime.stateSnapshot())
        if (kind === 'scene') expect((steps.nativeState as Record<string, unknown>)[key]).toBe(1)
        await expect.poll(async () => { const value = await probe(frame); steps.afterInput = { probe: value, pixels: await pixels(frame) }; return value.radius }).toBe(18)
        const high = await pixels(frame)
        expect(high.dark).toBeGreaterThan(before.pixels.dark * 10)
        expect(await input.inputValue()).toBe('1')
        await page.screenshot({ path: `${prefix}.${mode}.active.png` })
        await input.fill('7'); expect(await input.inputValue()).toBe('7')
        await page.evaluate(async () => { await (window as any).workPlayer.go('away') })
        if (mode === 'published') await expect.poll(async () => (await probe(frame)).activity?.active).toBe(false)
        await expect.poll(async () => (await probe(frame)).pending).toBe(0)
        const paused = await probe(frame); await page.waitForTimeout(120)
        expect((await probe(frame)).paints).toBe(paused.paints); steps.away = paused
        await page.evaluate(async () => { await (window as any).workPlayer.go('scene') })
        await expect.poll(async () => (await probe(frame)).paints).toBeGreaterThan(paused.paints)
        expect(frame.name()).toBe(leaseName)
        const returned = await probe(frame); expect(returned.canvases).toBe(1); expect(returned.pending).toBe(1)
        expect(await page.getByRole('textbox', { name: '前景输入' }).inputValue()).toBe('7')
        steps.returned = returned; steps.returnedPixels = await pixels(frame)
        if (mode === 'published') expect(await page.evaluate(() => (window as any).reports)).toEqual([])
        expect(errors).toEqual([])
        await page.evaluate(() => (window as any).workPlayer.dispose())
        expect(await page.locator(`${host} iframe`).count()).toBe(0)
        if (mode === 'compiled') {
          await expect.poll(async () => (await probe(frame)).pending).toBe(0)
          const disposed = await probe(frame); await page.waitForTimeout(120)
          expect((await probe(frame)).paints).toBe(disposed.paints)
          steps.disposedProbe = disposed
        }
        steps.disposed = true
      } catch (error) { await page.screenshot({ path: `${prefix}.${mode}.failure.png` }).catch(() => {}); throw error }
      finally { await page.close() }
    }
  } catch (error) { failure = error; throw error }
  finally {
    facts.status = failure ? 'failed' : 'passed'; if (failure) facts.failure = String(failure)
    await writeFile(`${prefix}.facts.json`, JSON.stringify(facts, null, 2))
    await browser.close()
  }
}, 60_000)
