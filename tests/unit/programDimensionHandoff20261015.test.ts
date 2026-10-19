// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { prepareMeasurementDocument } from '../../src/main/workbench/contentApply/measurement/prepareMeasurementDocument'
import { assemblyContentDraft } from '../../src/main/workbench/contentApply/application/html'
import { confirmProgramRootSize, sourceProgramAssembly, type HtmlDesignCapture } from '../../src/core/contentApply/assembly/htmlAssembly'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { WEB_DEFINITION } from '../../src/components/web/data'
import { createTextComponentData } from '../../src/components/text/data'
import { ContentApplyService } from '../../src/main/workbench/contentApply/applyService'
import { ComponentProjectFileCoordinator, type ComponentProjectSnapshot } from '../../src/core/projectFiles/componentPlatform/coordinator'
import { modelToolResult } from '../../src/core/tools/modelToolResult'
import { jsonValueSchema, type ComponentEdit } from '../../src/shared/contracts/component-platform'
import { planContentApply } from '../../src/main/workbench/contentApply/application/plan'

let browser: Browser, page: Page, script: string
beforeAll(async () => {
 const bundle = await build({ stdin: { contents: "export {captureHtmlDesignViewport} from './src/main/workbench/contentApply/measurement/browserCapture';export {cssUsesViewport} from './src/components/web/measuredFragmentBox';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'DimensionCapture', target: 'es2022' })
 script = bundle.outputFiles[0]?.text ?? ''
 if (!script) throw new Error('Capture bundle required')
 browser = await chromium.launch({ headless: true })
 page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
 await page.addScriptTag({ content: script })
})
afterAll(async () => { await browser?.close() })

async function capture(html: string, viewport = { width: 1280, height: 720 }) {
 const prepared = prepareMeasurementDocument({ html })
 await page.setViewportSize(viewport)
 await page.setContent(prepared.html)
 const capture = await page.evaluate<HtmlDesignCapture>(() => {
   const api = (window as unknown as { DimensionCapture: { captureHtmlDesignViewport(wait: number, css: unknown): Promise<HtmlDesignCapture>; cssUsesViewport: unknown } }).DimensionCapture
   return api.captureHtmlDesignViewport(200, api.cssUsesViewport)
 })
 const root = capture.programRoot
 if (root) {
   if (prepared.documentKind !== 'fragment') delete root.localPlacement
   await page.setViewportSize({ width: Math.ceil(root.width + (root.localPlacement ? 0 : root.x)), height: Math.ceil(root.height + (root.localPlacement ? 0 : root.y)) })
   const box = await page.evaluate(async ({ sourcePath, media }) => {
     await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
     let node: Node | undefined = document.body
     for (const index of sourcePath) node = node?.childNodes[index]
     if (!(node instanceof Element)) return undefined
     const rect = node.getBoundingClientRect()
     return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, mediaMatches: media.map(query => matchMedia(query).matches) }
   }, { sourcePath: [...root.sourcePath], media: root.media?.map(value => value.query) ?? [] })
   confirmProgramRootSize(capture, box)
 }
 return capture
}

interface ProgramPlacementSample {
 id: string
 selector?: string
 html: string
 beforeRepairHtml?: string
 frame: { width: number; height: number; transform: [number, number, number, number, number, number] }
}
async function placementSample(name: string): Promise<ProgramPlacementSample> {
 return JSON.parse(await readFile('tests/fixtures/programPlacement20261016.inputs.json', 'utf8'))[name] as ProgramPlacementSample
}

it.each(['evidence', 'advice', 'route'])('automatically assembles the frozen %s program at its authored page position without locking its movement', async name => {
 const sample = await placementSample(name)
 const shell = await capture(sample.html)
 expect(shell.programRoot?.localPlacement).toBe(true)
 expect(shell.fixedProgramSize).toEqual({ width: sample.frame.width, height: sample.frame.height })
 const before = await page.evaluate(id => {
   const root = document.getElementById(id)!, rect = root.getBoundingClientRect(), child = [...root.children].find(element => element.getClientRects().length)!.getBoundingClientRect()
   return { child: { x: child.x - rect.x, y: child.y - rect.y, width: child.width, height: child.height },
     sourceStyle: root.getAttribute('style'), scripts: [...document.scripts].map(script => script.textContent) }
 }, sample.id)
 const assembly = sourceProgramAssembly(shell.viewport, { html: sample.html }, 'script', [], shell)
 const { draft } = assemblyContentDraft(assembly, {}, { definitions: {}, createFormulaId: () => crypto.randomUUID() })
 expect(draft.frame).toEqual(sample.frame)
 expect(assembly.root.program?.html).toBe(sample.html)
 const data = draft.data
 if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.html !== 'string') throw new Error('Retained program HTML required')
 await page.setViewportSize({ width: sample.frame.width, height: sample.frame.height })
 await page.setContent(data.html)
 const local = await page.evaluate(id => {
   const root = document.getElementById(id)!, rect = root.getBoundingClientRect(), child = [...root.children].find(element => element.getClientRects().length)!.getBoundingClientRect()
   return { root: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
     child: { x: child.x - rect.x, y: child.y - rect.y, width: child.width, height: child.height },
     sourceStyle: root.getAttribute('style'), scripts: [...document.scripts].map(script => script.textContent) }
 }, sample.id)
 expect(local).toEqual({ root: { x: 0, y: 0, width: sample.frame.width, height: sample.frame.height }, ...before })
 const moved = await page.evaluate(id => {
   const root = document.getElementById(id) as HTMLElement
   root.style.left = `${parseFloat(root.style.left) + 17}px`
   root.style.top = `${parseFloat(root.style.top) + 11}px`
   root.style.transform = 'translate(7px, 5px)'
   const rect = root.getBoundingClientRect()
   return { x: rect.x, y: rect.y }
 }, sample.id)
 expect(moved).toEqual({ x: 24, y: 16 })
})

it('retains document-shell clipping around the original canvas when localizing a fixed program', async () => {
 const sample = await placementSample('evidence')
 const html = `<style>html,body{overflow:hidden}</style>${sample.html}`
 const shell = await capture(html)
 const assembly = sourceProgramAssembly(shell.viewport, { html }, 'script', [], shell)
 const { draft } = assemblyContentDraft(assembly, {}, { definitions: {}, createFormulaId: () => crypto.randomUUID() })
 expect(draft.frame).toEqual(sample.frame)
 const data = draft.data
 if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.html !== 'string') throw new Error('Retained program HTML required')
 await page.setViewportSize({ width: sample.frame.width, height: sample.frame.height })
 await page.setContent(data.html)
 const visible = await page.evaluate(id => {
   const root = document.getElementById(id)!, rect = root.getBoundingClientRect()
   return { right: root.contains(document.elementFromPoint(rect.right - 30, rect.bottom - 30)),
     bodyOverflow: getComputedStyle(document.body).overflow }
 }, sample.id)
 expect(visible).toEqual({ right: true, bodyOverflow: 'hidden' })
})

it.each(['sim', 'evidence', 'design', 'proposal'])('contains the software canvas overflow in the frozen second-run %s carrier without rewriting author coordinates', async name => {
 const sample = await placementSample(`run2-${name}`)
 if (!sample.beforeRepairHtml || !sample.selector) throw new Error('Frozen pre-repair program and selector required')
 await page.setViewportSize({ width: sample.frame.width, height: sample.frame.height })
 await page.setContent(sample.beforeRepairHtml)
 const prior = await page.evaluate(() => ({ width: innerWidth, height: innerHeight,
   scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight,
   overflow: getComputedStyle(document.documentElement).overflow }))
 expect(prior.overflow).toBe('visible')
 expect(prior.scrollWidth > prior.width || prior.scrollHeight > prior.height).toBe(true)
 const shell = await capture(sample.html)
 const assembly = sourceProgramAssembly(shell.viewport, { html: sample.html }, 'script', [], shell)
 const { draft } = assemblyContentDraft(assembly, {}, { definitions: {}, createFormulaId: () => crypto.randomUUID() })
 expect(draft.frame).toEqual(sample.frame)
 const data = draft.data
 if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.html !== 'string') throw new Error('Retained program HTML required')
 await page.setViewportSize({ width: sample.frame.width, height: sample.frame.height })
 await page.setContent(data.html)
 const actual = await page.evaluate(selector => {
   const root = document.querySelector(selector)!, rect = root.getBoundingClientRect(), body = document.body.getBoundingClientRect()
   return { viewport: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
     overflow: getComputedStyle(document.documentElement).overflow,
     body: { x: body.x, y: body.y, width: body.width, height: body.height },
     root: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
     right: root.contains(document.elementFromPoint(rect.right - 30, rect.bottom - 30)), sourceStyle: root.getAttribute('style') }
 }, sample.selector)
 expect(actual.viewport).toEqual({ width: sample.frame.width, height: sample.frame.height })
 expect(actual.overflow).toBe('hidden')
 expect(actual.body).toEqual({ x: -sample.frame.transform[4], y: -sample.frame.transform[5], width: 1280, height: 720 })
 expect(actual.root).toEqual({ x: 0, y: 0, width: sample.frame.width, height: sample.frame.height })
 expect(actual.right).toBe(true)
 expect(actual.sourceStyle).toBe(/<section style="([^"]+)"/.exec(sample.html)?.[1])
 await page.mouse.move(200, 100)
 await page.mouse.wheel(240, 240)
 await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
 expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: 0, y: 0 })
 const moved = await page.evaluate(selector => {
   const root = document.querySelector(selector) as HTMLElement
   root.style.left = `${parseFloat(root.style.left) + 17}px`
   root.style.top = `${parseFloat(root.style.top) + 11}px`
   root.style.transform = 'translate(7px, 5px)'
   const rect = root.getBoundingClientRect()
   return { x: rect.x, y: rect.y }
 }, sample.selector)
 expect(moved).toEqual({ x: 24, y: 16 })
})

it('keeps sibling program/data nodes and preserves the current formal frame when replacing a placed local program', async () => {
 const sample = await placementSample('evidence')
 const html = `${sample.html}<template id="program-data"><span>Preserve data</span></template><script>/* sibling program stays executable */</script>`
 const project = createBlankCourseProjectV10('Local program placement'), surface = project.surfaces[0]!
 project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
 project.instances.heading = { id: 'heading', definitionId: TEXT_DEFINITION.id, data: jsonValueSchema.parse(createTextComponentData('Keep this heading')),
   frame: { width: 1120, height: 165, transform: [1, 0, 0, 1, 56, 0] } }
 surface.childIds = ['heading']
 const heading = structuredClone(project.instances.heading)
 const session = await DocumentSession.create({ documentId: 'local-placement', epoch: 'epoch',
   binding: { kind: 'file', path: 'local-placement.glx', version: null, bindingVersion: 0 },
   model: { kind: 'course-v10', project, resources: { assets: {}, components: {} } } }, new CourseV10Driver(),
 { async append() {}, async save(input) { if (input.binding.kind !== 'file') throw new Error('File binding required'); return input.binding } })
 const snapshot = () => session.read() as ComponentProjectSnapshot
 let serial = 0, measurements = 0
 const service = new ContentApplyService({ createId: () => `local-${++serial}`,
   compilation: { async compile() { throw new Error('Builtin program must not compile') } },
   measure: async input => {
     measurements++
     const shell = await capture(input.html, input.viewport)
     return sourceProgramAssembly(shell.viewport, { html: input.html }, 'script', [], shell)
   },
   session: { project: () => snapshot().model.project, dispatch: command => {
     const current = snapshot()
     return session.execute({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
       operationId: `apply-${++serial}`, actor: 'agent', mutation: { type: 'command', command } })
   } } })
 const inserted = await service.apply({ intent: 'insert', target: { kind: 'container', container: { kind: 'surface', surfaceId: surface.id } }, source: { kind: 'html', html } })
 expect(inserted.commit).toBe('committed')
 const id = inserted.insertedIds[0]!
 const instance = snapshot().model.project.instances[id]!
 expect(instance.frame).toEqual(sample.frame)
 const data = instance.data
 if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.html !== 'string') throw new Error('Retained local program source required')
 expect(data.html).toContain('id="program-data"')
 expect(data.html).toContain('/* sibling program stays executable */')
 const manualFrame = { width: 740, height: 360, transform: [1, 0, 0, 1, 427, 222] as [number, number, number, number, number, number] }
 const current = snapshot()
 await session.execute({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
   operationId: 'manual-frame', actor: 'human', mutation: { type: 'command', command: captureComponentOperation(current.model.project, [{ type: 'frame.set', instanceId: id, frame: manualFrame }]) } })
 const changed = data.html.replace('你的实验记录', '更新的实验记录')
 const unusedRegion = { width: 1000, height: 500, transform: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number] }
 const edited = await service.apply({ intent: 'content', target: { kind: 'instance', instanceId: id }, region: unusedRegion, source: { kind: 'html', html: changed } })
 expect(edited.commit).toBe('committed')
 expect(snapshot().model.project.instances[id]?.frame).toEqual(manualFrame)
 expect(snapshot().model.project.instances.heading).toEqual(heading)
 expect(snapshot().model.project.surfaces[0]?.childIds).toEqual(['heading', id])
 expect(measurements).toBe(1)
 const redone = await service.apply({ intent: 'redo', target: { kind: 'instance', instanceId: id }, region: unusedRegion, source: { kind: 'html', html: sample.html.replace('你的实验记录', '重做的实验记录') } })
 expect(redone.commit).toBe('committed')
 expect(snapshot().model.project.instances[id]?.frame).toEqual(manualFrame)
 expect(snapshot().model.project.instances.heading).toEqual(heading)
 expect(measurements).toBe(2)
})

it('uses the frozen explicitly sized program region instead of the whole page', async () => {
 const html = await readFile('tests/fixtures/programDimensionHandoff20261015.html', 'utf8')
 const shell = await capture(html)
 const assembly = sourceProgramAssembly(shell.viewport, { html }, 'script', shell.diagnostics, shell)
 expect(assembly.root.frame).toEqual({ width: 1168, height: 490, transform: [1, 0, 0, 1, 0, 0] })
 expect(assembly.root.program?.html).toBe(html)
})

it('accepts a fixed stage authored in CSS and retains its positive leading space', async () => {
 const html = '<style>#stage{width:480px;height:280px;margin:20px 0 0 30px}</style><section id="stage">Stage</section><script>window.ready=true</script>'
 const shell = await capture(html)
 expect(sourceProgramAssembly(shell.viewport, { html }, 'script', [], shell).root.frame).toEqual({ width: 510, height: 300, transform: [1, 0, 0, 1, 0, 0] })
})

it.each([
 '<div>Ready</div><script>document.body.innerHTML="Dynamic stage"</script>',
 '<section style="width:100%;height:100%">Responsive</section><script>window.ready=true</script>',
 '<section style="width:480px;height:280px"><div style="height:100vh">Viewport scene</div></section><script>window.ready=true</script>',
 '<style>#stage{width:480px;height:280px}@media(max-width:1000px){#stage{width:600px}}</style><section id="stage">Stage</section><script>window.ready=true</script>',
 '<section style="width:480px;height:280px;margin:0 auto">Centered</section><script>window.ready=true</script>',
 '<style>#stage{width:480px;height:280px}#stage p{margin:0;font-size:16px}@media(max-width:1000px){#stage p{font-size:50px}}</style><section id="stage"><p>Viewport text</p></section><script>window.ready=true</script>',
 '<style>#stage{width:480px;height:280px}#stage p{margin:0;font-size:16px}</style><style media="(max-width:1000px)">#stage p{font-size:50px}</style><section id="stage"><p>Sheet media text</p></section><script>window.ready=true</script>',
 '<style>@import url("data:text/css,%40media(max-width%3A1000px)%7B%23stage%20p%7Bfont-size%3A50px%7D%7D");#stage{width:480px;height:280px;font-size:16px}#stage p{margin:0}</style><section id="stage"><p>Import media text</p></section><script>window.ready=true</script>',
])('keeps the allocated viewport when a program has no independent fixed stage', async html => {
 const shell = await capture(html)
 expect(sourceProgramAssembly(shell.viewport, { html }, 'script', [], shell).root.frame).toEqual({ width: 1280, height: 720, transform: [1, 0, 0, 1, 0, 0] })
})

it('places the program beside existing content and hands current frame to the next same-object edit', async () => {
 const project = createBlankCourseProjectV10('Dimension handoff'), surface = project.surfaces[0]
 if (!surface) throw new Error('Initial surface required')
 project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
 project.instances.heading = { id: 'heading', definitionId: TEXT_DEFINITION.id, data: jsonValueSchema.parse(createTextComponentData('Keep this title')),
   frame: { width: 1120, height: 165, transform: [1, 0, 0, 1, 56, 0] } }
 surface.childIds = ['heading']
 const heading = structuredClone(project.instances.heading)
 const driver = new CourseV10Driver()
 const session = await DocumentSession.create({ documentId: 'dimensions', epoch: 'epoch',
   binding: { kind: 'file', path: 'dimensions.glx', version: null, bindingVersion: 0 },
   model: { kind: 'course-v10', project, resources: { assets: {}, components: {} } } }, driver, { async append() {}, async save(input) { if (input.binding.kind !== 'file') throw new Error('File binding required'); return input.binding } })
 let serial = 0, measurements = 0
 const snapshot = () => {
   const value = session.read()
   if (value.model.kind !== 'course-v10') throw new Error('Course required')
   return value as ComponentProjectSnapshot
 }
 const coordinator = new ComponentProjectFileCoordinator({ document: async () => snapshot(),
   async source() { throw new Error('Literal source only') },
   async apply(_run, operationId, _digest, baseline, request) {
     const service = new ContentApplyService({ createId: () => `added-${++serial}`, compilation: { async compile() { throw new Error('Builtin program must not compile') } },
       measure: async input => {
         measurements++
         const shell = await capture(input.html, input.viewport)
         return sourceProgramAssembly(shell.viewport, { html: input.html }, 'script', shell.diagnostics, shell)
       },
       session: { project: () => baseline.model.project,
         dispatch: command => session.execute({ documentId: baseline.documentId, epoch: baseline.epoch, baseRevision: baseline.revision,
           operationId, actor: 'agent', mutation: { type: 'command', command } }) } })
     return service.apply(request)
   } })
 const listed = await coordinator.execute('run', 'list', 'list', 'project.list', {})
 if (listed.kind !== 'read') throw new Error('File list required')
 const files = listed.data as { files: { path: string; type: string }[] }
 const structure = files.files.find(file => file.type === 'structure')
 if (!structure) throw new Error('Surface path required')
 const html = await readFile('tests/fixtures/programDimensionHandoff20261015.html', 'utf8')
 const inserted = await coordinator.execute('run', 'insert', 'insert', 'project.apply', { path: structure.path, intent: 'insert', content: html })
 expect(inserted).toMatchObject({ kind: 'read', data: { commit: 'committed', frame: { width: 1168, height: 490 }, viewport: { width: 1168, height: 490 } } })
 if (inserted.kind !== 'read') throw new Error('Insertion receipt required')
 const receipt = inserted.data as { insertedIds: string[]; currentPath?: string; path?: string }
 const id = receipt.insertedIds[0], path = receipt.currentPath ?? receipt.path
 if (!id || !path) throw new Error('Inserted identity and current path required')
 const firstFrame = snapshot().model.project.instances[id]?.frame
 if (!firstFrame) throw new Error('Program frame required')
 expect(firstFrame.transform[5]).toBeGreaterThanOrEqual(165)
 expect(snapshot().model.project.instances.heading).toEqual(heading)
 const resized = { width: 640, height: 360, transform: [1, 0, 0, 1, 71, 210] as [number, number, number, number, number, number] }
 const beforeHuman = snapshot()
 const edits: ComponentEdit[] = [{ type: 'frame.set', instanceId: id, frame: resized }]
 const human = await session.execute({ documentId: beforeHuman.documentId, epoch: beforeHuman.epoch, baseRevision: beforeHuman.revision,
   operationId: 'human-resize', actor: 'human', mutation: { type: 'command', command: captureComponentOperation(beforeHuman.model.project, edits) } })
 expect(human.status).toBe('applied')
 const read = await coordinator.execute('run', 'read-current', 'read-current', 'project.read', { path })
 expect(modelToolResult('project.read', read)).toMatchObject({ kind: 'read', data: { frame: resized, viewport: { width: 640, height: 360 } } })
 const changed = html.replace('width:1168px;height:490px', 'width:100%;height:100%').replace('纸封很薄', '当前区域内容')
 const applied = await coordinator.execute('run', 'continue', 'continue', 'project.apply', { path, content: changed })
 expect(modelToolResult('project.apply', applied)).toMatchObject({ kind: 'read', data: { commit: 'committed', frame: resized, viewport: { width: 640, height: 360 } } })
 const after = snapshot().model.project
 expect(after.instances[id]?.frame).toEqual(resized)
 expect(after.instances.heading).toEqual(heading)
 expect(after.surfaces[0]?.childIds).toEqual(['heading', id])
 expect(measurements).toBe(1)
})

it('adopts a responsive program into one explicit local region with a usable action and feedback', async () => {
 const project = createBlankCourseProjectV10('Local responsive region'), surface = project.surfaces[0]!
 project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
 project.instances.heading = { id: 'heading', definitionId: TEXT_DEFINITION.id, data: jsonValueSchema.parse(createTextComponentData('Native heading stays above')),
   frame: { width: 1120, height: 165, transform: [1, 0, 0, 1, 56, 0] } }
 surface.childIds = ['heading']
 const heading = structuredClone(project.instances.heading), driver = new CourseV10Driver()
 const session = await DocumentSession.create({ documentId: 'responsive-region', epoch: 'epoch',
   binding: { kind: 'file', path: 'responsive-region.glx', version: null, bindingVersion: 0 },
   model: { kind: 'course-v10', project, resources: { assets: {}, components: {} } } }, driver,
 { async append() {}, async save(input) { if (input.binding.kind !== 'file') throw new Error('File binding required'); return input.binding } })
 const snapshot = () => session.read() as ComponentProjectSnapshot
 const html = await readFile('tests/fixtures/contentLocalRegion20261019.html', 'utf8')
 const region = { width: 640, height: 360, transform: [1, 0, 0, 1, 320, 180] as [number, number, number, number, number, number] }
 const measured: { width: number; height: number }[] = [], prepared: { width: number; height: number }[] = []
 let serial = 0
 const coordinator = new ComponentProjectFileCoordinator({ document: async () => snapshot(),
   source: async () => ({ filename: 'responsive.html', bytes: new TextEncoder().encode(html), text: html }),
   async prepareSource(input, file) {
     prepared.push(file.programViewport!)
     input.diagnostics = [{ level: 'warning', code: 'source-file-finding', file: 'responsive.html', message: 'Retained source preparation finding', repairable: true }]
     return { kind: 'html', html: input.text! }
   },
   async apply(_run, operationId, _digest, baseline, request) {
     return new ContentApplyService({ createId: () => `region-${++serial}`,
       compilation: { async compile() { throw new Error('Builtin program must not compile') } },
       measure: async input => {
         measured.push(input.viewport)
         const shell = await capture(input.html, input.viewport)
         return sourceProgramAssembly(shell.viewport, { html: input.html }, 'script', shell.diagnostics, shell)
       },
       session: { project: () => baseline.model.project,
         dispatch: command => session.execute({ documentId: baseline.documentId, epoch: baseline.epoch, baseRevision: baseline.revision,
           operationId, actor: 'agent', mutation: { type: 'command', command } }) } }).apply(request)
   } })
 const list = await coordinator.execute('region', 'list', 'list', 'project.list', {})
 if (list.kind !== 'read') throw new Error('Current files required')
 const path = (list.data as { files: { path: string; type: string }[] }).files.find(file => file.type === 'structure')!.path
 const before = snapshot()
 const result = await coordinator.execute('region', 'insert', 'insert', 'project.apply', { path, intent: 'insert', region, from: 'responsive.html' })
 expect(result, JSON.stringify(result)).toMatchObject({ kind: 'read', data: { commit: 'committed', frame: region, viewport: { width: 640, height: 360 } } })
 expect(result).toMatchObject({ kind: 'read', data: { diagnostics: expect.arrayContaining([expect.objectContaining({ code: 'source-file-finding', file: 'responsive.html' })]) } })
 expect(measured).toEqual([{ width: 640, height: 360 }])
 expect(prepared).toEqual([{ width: 640, height: 360 }])
 if (result.kind !== 'read') throw new Error('Commit receipt required')
 const id = (result.data as { insertedIds: string[] }).insertedIds[0]!
 const current = snapshot(), instance = current.model.project.instances[id]!
 expect(instance.frame).toEqual(region)
 expect(current.model.project.instances.heading).toEqual(heading)
 expect(current.model.project.surfaces[0]?.childIds).toEqual(['heading', id])
 expect(current.undoDepth).toBe(before.undoDepth + 1)
 const reopened = driver.load(driver.serialize(current.model))
 if (reopened.kind !== 'course-v10') throw new Error('Saved course required')
 expect(reopened.project.instances[id]?.frame).toEqual(region)
 const data = reopened.project.instances[id]!.data
 if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.html !== 'string') throw new Error('Current HTML source required')
 // Measurement deliberately disables scripts with CSP. Runtime needs a fresh
 // document, as the real program carrier does, rather than that capture page.
 const runtime = await browser.newPage({ viewport: { width: region.width, height: region.height } })
 try {
   await runtime.setContent(data.html)
   expect(await runtime.locator('#stage').boundingBox()).toMatchObject({ x: 0, y: 0, width: 640, height: 360 })
   expect(await runtime.locator('#vw').boundingBox()).toMatchObject({ width: 320, height: 72 })
   await runtime.locator('#run').click()
   expect(await runtime.locator('#feedback').textContent()).toBe('运行完成，反馈可见')
   const feedback = await runtime.locator('#feedback').boundingBox()
   expect(feedback && feedback.y + feedback.height).toBeLessThanOrEqual(region.height)
 } finally { await runtime.close() }
 expect(await session.execute({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
   operationId: 'undo-local-region', actor: 'human', mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
 expect(snapshot().model.project.instances).toEqual({ heading })
})

it('keeps explicit overlap and diagnoses actual region/container overflow without moving existing objects', () => {
 const project = createBlankCourseProjectV10('Explicit overlap'), surface = project.surfaces[0]!
 project.definitions[WEB_DEFINITION.id] = WEB_DEFINITION
 project.instances.neighbor = { id: 'neighbor', definitionId: WEB_DEFINITION.id, data: { html: 'Keep' },
   frame: { width: 300, height: 100, transform: [1, 0, 0, 1, 0, 0] } }
 surface.childIds = ['neighbor']
 const region = { width: 100, height: 100, transform: [1, 0, 0, 1, 10, 20] as [number, number, number, number, number, number] }
 const plan = planContentApply({ project, createId: () => 'inserted', request: { intent: 'insert', region,
   target: { kind: 'container', container: { kind: 'surface', surfaceId: surface.id } },
   source: { kind: 'objects', objects: [{ definitionId: WEB_DEFINITION.id, data: { html: 'Wide' },
     frame: { width: 1500, height: 100, transform: [1, 0, 0, 1, 0, 0] } }] } } })
 expect(plan.command.edits.find(edit => edit.type === 'instance.insert')).toMatchObject({ instances: [{ id: 'inserted', frame: { width: 1500, height: 100, transform: [1, 0, 0, 1, 10, 20] } }] })
 expect(plan.diagnostics.map(item => item.code)).toEqual(expect.arrayContaining(['insertion-overlap', 'content-region-overflow', 'insertion-container-overflow']))
 expect(plan.command.edits.every(edit => edit.type !== 'frame.set')).toBe(true)
 expect(project.instances.neighbor.frame?.transform).toEqual([1, 0, 0, 1, 0, 0])
})

it.each(['resized', 'unframed', 'parent'] as const)('keeps %s presentation-state geometry consistent between source read and apply', async kind => {
 const project = createBlankCourseProjectV10('State frame'), surface = project.surfaces[0]
 if (!surface) throw new Error('Surface required')
 const source = 'export default { mount() {} };'
 project.definitions.local = { id: 'local', role: 'content', implementation: { kind: 'source', language: 'javascript', source } }
 project.instances.local = { id: 'local', definitionId: 'local', data: {}, frame: { width: 320, height: 180, transform: [1, 0, 0, 1, 0, 0] } }
 const frame = { width: 640, height: 360, transform: [0, 1, -1, 0, 100, 50] as [number, number, number, number, number, number] }
 surface.childIds = ['local']
 surface.presentation = { states: [{ id: 'state', title: 'Local', overrides: { local: { frame: kind === 'resized' ? frame : null } } }] }
 if (kind === 'parent') {
   project.definitions[WEB_DEFINITION.id] = WEB_DEFINITION
   project.instances.parent = { id: 'parent', definitionId: WEB_DEFINITION.id, data: { html: '<div></div>' }, childIds: ['local'],
     frame: { width: 800, height: 500, transform: [1, 0, 0, 1, 0, 0] } }
   surface.childIds = ['parent']
   surface.presentation.states[0].overrides.parent = { frame: { width: 1000, height: 600, transform: [1, 0, 0, 1, 0, 0] } }
 }
 const session = await DocumentSession.create({ documentId: `state-${kind}`, epoch: 'epoch',
   binding: { kind: 'file', path: 'state.glx', version: null, bindingVersion: 0 }, model: { kind: 'course-v10', project, resources: { assets: {}, components: {} } } },
 new CourseV10Driver(), { async append() {}, async save(input) { if (input.binding.kind !== 'file') throw new Error('File binding required'); return input.binding } })
 const snapshot = () => session.read() as ComponentProjectSnapshot
 const coordinator = new ComponentProjectFileCoordinator({ document: async () => snapshot(),
   scope: () => ({ kind: 'instance', instanceId: 'local', state: { surfaceId: surface.id, stateId: 'state' } }),
   async source() { throw new Error('Literal source only') },
   async apply(_run, operationId, _digest, baseline, request) {
     if (request.intent !== 'canonical') throw new Error('Canonical source operation required')
     const receipt = await session.execute({ documentId: baseline.documentId, epoch: baseline.epoch, baseRevision: baseline.revision,
       operationId, actor: 'agent', mutation: { type: 'command', command: captureComponentOperation(baseline.model.project, request.edits) } })
     return { commit: receipt.status === 'applied' ? 'committed' : 'unchanged', usability: 'usable', delivery: 'not_requested', input: request, diagnostics: [], insertedIds: [], receipt }
   } })
 const listed = await coordinator.execute('run', 'list', 'list', 'project.list', {})
 if (listed.kind !== 'read') throw new Error('Source list required')
 const files = listed.data as { files: { path: string; type: string }[] }
 const file = files.files.find(value => value.type === 'source' && value.path.startsWith('pages/') && value.path.includes('local') && value.path.endsWith('.view.js'))
 if (!file) throw new Error('Source entry required')
 const expectedViewport = kind === 'resized' ? { width: 640, height: 360 } : kind === 'parent' ? { width: 1000, height: 600 } : { width: 1280, height: 720 }
 const read = await coordinator.execute('run', 'read', 'read', 'project.read', { path: file.path })
 expect(read).toMatchObject({ kind: 'read', data: { viewport: expectedViewport, ...(kind === 'resized' ? { frame } : {}) } })
 const applied = await coordinator.execute('run', 'apply', 'apply', 'project.apply', { path: file.path, content: source + '\n// continued in current area' })
 expect(applied).toMatchObject({ kind: 'read', data: { commit: 'committed', viewport: expectedViewport, ...(kind === 'resized' ? { frame } : {}) } })
 if (kind !== 'resized' && read.kind === 'read' && applied.kind === 'read') {
   expect(read.data).not.toHaveProperty('frame')
   expect(applied.data).not.toHaveProperty('frame')
 }
 expect(snapshot().model.project.instances.local?.frame?.width).toBe(320)
})
