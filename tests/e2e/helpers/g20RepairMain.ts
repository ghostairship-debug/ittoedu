import { app, BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
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
    const beforeBytes = service.readResource('task', first.image.resourceId).bytes
    const afterBytes = service.readResource('task', clicked.image.resourceId).bytes
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
      pixelsChanged: digest(beforeBytes) !== digest(afterBytes), bytes: afterBytes.length,
      width: clicked.image.width, height: clicked.image.height, repeatGeneration: repeat.generation === clicked.generation,
      staleRejected, cancelled, deniedRequests: hits, diskUnchanged: await fs.readFile(file, 'utf8') === disk,
      windowsRestored: BrowserWindow.getAllWindows().length === baselineWindows }
  } finally {
    service.stopRun('task'); service.stopRun('cancel-opening'); preview.dispose(); live.dispose()
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
