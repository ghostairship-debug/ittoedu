import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DocumentHostService } from '../../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '../../../src/core/course/createCourseProjectV10'
import { componentProjectFiles } from '../../../src/core/projectFiles/componentPlatform'
import { measureHtmlAtDesignViewport } from '../../../src/main/workbench/contentApply/measurement/ElectronHtmlDesignMeasurement'

app.whenReady().then(async () => {
  const directory = process.env.GUOLING_W3_DIRECTORY!
  let host = new DocumentHostService(path.join(directory, 'journal'))
  const project = createBlankCourseProjectV10('W3 semantic import')
  project.surfaces = [{ id: 'slide', kind: 'slide', title: 'W3', childIds: [], designSize: { width: 1280, height: 720 } }]
  let snapshot = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'semantics.h5lesson')
  let serial = 0, runSerial = 0, runId = ''
  const course = () => { if (snapshot.model.kind !== 'course-v10') throw new Error('Expected V10'); return snapshot.model }
  const run = async () => {
    runId = `w3-run-${++runSerial}`
    await host.tools.beginRun({ runId, actor: 'agent', documents: [{ documentId: snapshot.documentId, writable: [{ kind: 'document' }] }], fileAccess: { permission: 'workspace', workspaceRoot: directory } })
    await host.tools.loadToolFamilies(runId, ['content'])
  }
  await run()
  let window = new BrowserWindow({ width: 820, height: 640, show: false, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } })
  await window.loadFile(path.join(directory, 'index.html'))
  const call = (name: string, input: unknown) => host.tools.execute(runId, `w3-${++serial}`, { name, input })
  const update = async () => { snapshot = await host.internalAPI.read(snapshot.documentId); return course() }
  ;(globalThis as any).w3Fixture = {
    window,
    async freshWindow() {
      const previous = window
      window = new BrowserWindow({ width: 820, height: 640, show: false, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } })
      await window.loadFile(path.join(directory, 'index.html'))
      previous.close()
    },
    async newCourse() {
      await host.tools.stop(runId)
      snapshot = await host.internalAPI.create({ kind: 'course-v10', project: createBlankCourseProjectV10('W3 semantic variant'), resources: { assets: {}, components: {} } }, 'variant.h5lesson')
      await run()
    },
    async bare(html: string) {
      const bare = new BrowserWindow({ width: 820, height: 640, show: false, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } })
      await bare.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    },
    async insert(html: string) {
      const files = componentProjectFiles(course().project, course().resources)
      const file = files.find(value => value.kind === 'structure' && value.target?.kind === 'container' && value.target.container.kind === 'surface')!
      const result = await call('project.apply', { path: file.path, intent: 'insert', content: html })
      return { result, model: await update(), assembly: await measureHtmlAtDesignViewport({ html, viewport: { width: 1280, height: 720 } }) }
    },
    async edit(instanceId: string, html: string) {
      const file = componentProjectFiles(course().project, course().resources).find(value => value.target?.kind === 'instance' && value.target.instanceId === instanceId && value.kind === 'html')!
      if (!file) throw new Error('Content path missing')
      await call('project.read', { path: file.path })
      const result = await call('project.apply', { path: file.path, intent: 'content', content: html })
      return { result, model: await update(), path: file.path }
    },
    async undo() {
      const result = await host.internalAPI.dispatch({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision, operationId: randomUUID(), actor: 'human', mutation: { type: 'undo' } })
      return { result, model: await update() }
    },
    async save() { snapshot = await host.saveToPath(snapshot.documentId, path.join(directory, 'semantics.h5lesson')); return { revision: snapshot.revision, dirty: snapshot.dirty } },
    async reopen() { await host.tools.stop(runId); host = new DocumentHostService(path.join(directory, 'cold-journal')); snapshot = await host.open(path.join(directory, 'semantics.h5lesson')); await run(); return { model: course(), revision: snapshot.revision, dirty: snapshot.dirty } },
  }
}).catch(error => { (globalThis as any).w3FixtureError = String(error?.stack ?? error); console.error(error) })
