import { app, BrowserWindow } from 'electron'
import { splitHtmlSections } from '../../../src/main/workbench/htmlImport/splitHtmlSections'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { registerPrivilegedSchemes } from '../../../src/main/protocols'
import { HtmlPreviewService } from '../../../src/main/workbench/htmlPreview/HtmlPreviewService'
import { TaskHtmlPreview } from '../../../src/main/workbench/observation/TaskHtmlPreview'
import { HtmlActionService } from '../../../src/main/workbench/observation/HtmlActionService'
import { HtmlActionDesktopPort } from '../../../src/main/workbench/observation/HtmlActionDesktopPort'
import { ObservationImageStore } from '../../../src/main/workbench/observation/ObservationImageStore'
import type { DocumentSnapshot } from '../../../src/shared/workbench/document'

const directory = process.env.G20_REPAIR_DIR!
if (!directory) throw new Error('Missing isolated fixture directory')
app.setPath('userData', path.join(directory, 'profile'))
registerPrivilegedSchemes()
void app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 1600, height: 1000, useContentSize: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  const errors: string[] = []; Reflect.set(globalThis, 'repairRendererErrors', errors)
  window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message) })
  await window.loadFile(path.join(directory, 'index.html'))
})

Reflect.set(globalThis, 'repairPreviewScenario', async () => {
  const baselineWindows = BrowserWindow.getAllWindows().length
  const file = path.join(directory, 'preview.html'), disk = '<h1>Old disk content</h1>'
  await fs.writeFile(file, disk)
  let hits = 0
  const server = createServer((_request, response) => { hits++; response.end('unexpected') })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const denied = `http://127.0.0.1:${(server.address() as { port: number }).port}/denied`
  const snapshot: DocumentSnapshot = { documentId: 'doc', epoch: 'epoch', revision: 1,
    binding: { kind: 'file', path: file, bindingVersion: 1, version: null },
    model: { kind: 'text', source: `<!doctype html><h1>Current canonical source</h1><p id="count">Count 0</p><button id="add">Add</button><script>let n=0;document.getElementById('add').onclick=()=>document.getElementById('count').textContent='Count '+(++n);fetch('${denied}').catch(()=>{});</script>`, resources: { assets: {}, components: {} } },
    dirty: true, saving: false, recoverable: true, undoDepth: 0, redoDepth: 0 }
  let hold: Promise<void> | null = null
  const readDocument = async () => { if (hold) await hold; return snapshot }
  const live = new HtmlPreviewService({ readDocument, currentMainFrame: () => null, networkOwner: () => null })
  const preview = new TaskHtmlPreview({ live, readDocument,
    agentBundlePath: path.join(process.env.G20_REPAIR_ROOT!, 'dist-renderer/html-preview-agent.iife.js') })
  const images = new ObservationImageStore(), service = new HtmlActionService({ preview, images, frames: new HtmlActionDesktopPort() })
  const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
  try {
    await service.beginDocumentRun('task', { documentId: 'doc', epoch: 'epoch', revision: 1 })
    const first = await service.observe('task')
    const clicked = await service.click('task', { operationId: 'click-one', handle: first.elements.find(e => e.label === 'Add')!.handle })
    const repeat = await service.click('task', { operationId: 'click-one', handle: first.elements.find(e => e.label === 'Add')!.handle })
    const beforeBytes = (await service.readResource('task', first.image.resourceId)).bytes
    const afterBytes = (await service.readResource('task', clicked.image.resourceId)).bytes
    for (let i = 0; i < 10; i++) await service.observe('task')
    const earlierImageRetained = digest((await service.readResource('task', first.image.resourceId)).bytes) === digest(beforeBytes)
    await fs.writeFile(path.join(directory, 'isolated-html-before.png'), beforeBytes)
    await fs.writeFile(path.join(directory, 'isolated-html-after.png'), afterBytes)
    let staleRejected = false
    try { await service.click('task', { operationId: 'old-handle', handle: first.elements[0]!.handle }) } catch { staleRejected = true }
    snapshot.revision = 2
    snapshot.model = { ...snapshot.model, kind: 'text', source: '<h1>Revised source</h1><button>Changed</button>' }
    await service.restartDocumentRun('task', { documentId: 'doc', epoch: 'epoch', revision: 2 })
    const revised = await service.observe('task')
    service.stopRun('task')
    let release!: () => void
    hold = new Promise<void>(resolve => { release = resolve })
    const opening = service.beginDocumentRun('cancel-opening', { documentId: 'doc', epoch: 'epoch', revision: 2 }).then(() => false, () => true)
    await new Promise(resolve => setTimeout(resolve, 80))
    service.stopRun('cancel-opening'); release(); hold = null
    const cancelled = await opening
    return { source: first.source, first: first.structure, clicked: clicked.structure, revised: revised.structure,
      pixelsChanged: digest(beforeBytes) !== digest(afterBytes), bytes: afterBytes.length, earlierImageRetained,
      width: clicked.image.width, height: clicked.image.height, repeatGeneration: repeat.generation === clicked.generation,
      staleRejected, cancelled, deniedRequests: hits, diskUnchanged: await fs.readFile(file, 'utf8') === disk,
      windowsRestored: BrowserWindow.getAllWindows().length === baselineWindows }
  } finally {
    service.stopRun('task'); service.stopRun('cancel-opening'); preview.dispose(); live.dispose()
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

Reflect.set(globalThis, 'repairDraftPages', async () => {
  const html = '<!doctype html><html><head><style>body{margin:0;font:24px Arial}section{box-sizing:border-box;width:1024px;height:768px;padding:60px}button{font:inherit;padding:12px}svg{display:block}</style></head><body>'
    + Array.from({ length: 6 }, (_, index) => `<section><h2>Lesson ${index + 1}: observe the diagram</h2><svg width="400" height="150" aria-label="actual diagram"><circle cx="80" cy="75" r="50" fill="#18775d"/><circle cx="230" cy="75" r="50" fill="#315cb5"/></svg><input name="response" aria-label="Answer"><p data-result>Ready ${index + 1}</p><button name="show">Show result</button><script>(()=>{const page=document.currentScript.closest('section');const answers={};function answer(id,value){answers[id]=value}const input=page.querySelector('input');input.addEventListener('input',()=>answer(input.name,input.value));const actions={show:()=>{const n=Number(page.dataset.step||0);page.style.opacity=String(1-n*.1);page.style.transform='translateX('+n+'px)';page.querySelector('[data-result]').innerHTML='<strong>Verified ${index + 1}: '+answers.response+'</strong>';}};page.querySelector('button').addEventListener('click',event=>actions[event.currentTarget.name]());})();</script></section>`).join('') + '</body></html>'
  const split = splitHtmlSections(html, 'sections')
  const { createBlankCourseProject } = await import('../../../src/core/course/createCourseProject')
  const { CourseV9Driver } = await import('../../../src/core/drivers/CourseV9Driver')
  const { DocumentRegistry } = await import('../../../src/core/documents/DocumentRegistry')
  const { createDocumentJournal } = await import('../../../src/main/workbench/documentJournal')
  const { prepareHtmlCourseCandidate } = await import('../../../src/main/workbench/htmlImport/prepareHtmlCourseCandidate')
  const { unpackHtmlDocumentRuntimeSource } = await import('../../../src/shared/runtime/htmlDocumentSource')
  const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
  const slide = project.surfaces.find(surface => surface.type === 'slide')!
  slide.canvas = { width: 1024, height: 768 }
  const driver = new CourseV9Driver()
  const registry = new DocumentRegistry({ drivers: [driver], createId: randomUUID, bindingKey: binding => binding.path,
    persistence: createDocumentJournal({ directory: path.join(directory, 'draft-journal') }) })
  const session = await registry.create({ kind: 'course-v9', project, resources: { assets: {}, components: {} } }, 'draft.h5lesson')
  const snapshot = session.read()
  await fs.writeFile(path.join(directory, 'draft.html'), html, 'utf8')
  const prepared = await prepareHtmlCourseCandidate({ snapshot, sourcePath: path.join(directory, 'draft.html'), sourceHtml: html,
    sections: split.sections, mode: 'sections', destinations: split.sections.map((_page, index) => index === 0
      ? { kind: 'slide-existing', location: project.locations[0]!.id } : { kind: 'slide-new', surface: slide.id }) })
  const result = await session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision,
    operationId: 'fixture-draft-import', actor: 'human', mutation: { type: 'command', command: {
      type: 'course.replace', project: prepared.model.project, resources: prepared.model.resources } } })
  if (result.status !== 'applied') throw new Error('Fixture import did not commit')
  const filename = path.join(directory, 'six-page-draft.h5lesson')
  const saved = await session.save({ kind: 'file', path: filename, version: null, bindingVersion: 1 })
  await registry.close(snapshot.documentId)
  const bytes = await fs.readFile(filename), reopened = driver.load(bytes)
  if (reopened.kind !== 'course-v9' || saved.dirty) throw new Error('Fixture save/reopen failed')
  const pages = reopened.project.surfaces.flatMap(surface => surface.type === 'slide'
    ? surface.scenes.flatMap(scene => scene.layerItems.filter(item => item.kind === 'runtime')) : [])
  Reflect.set(globalThis, 'repairDraftPersistence', { revision: reopened.project.revision, dirty: saved.dirty,
    locations: reopened.project.locations.length, runtimePages: pages.length, fileBytes: bytes.byteLength, readFromArchive: true })
  return pages.map(item => {
    if (item.kind !== 'runtime') throw new Error('Missing Runtime')
    const source = unpackHtmlDocumentRuntimeSource(item.runtime.source)
    if (!source) throw new Error('Lost HTML source')
    return source.html
  })
})
