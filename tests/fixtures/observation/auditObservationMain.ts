import { app, BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DocumentHostService } from '../../../src/main/workbench/DocumentHostService'
import { registerPrivilegedSchemes } from '../../../src/main/protocols'
import { ViewObservationDesktopService } from '../../../src/main/workbench/observation/ViewObservationDesktopService'
import { ViewObservationService } from '../../../src/main/workbench/observation/ViewObservationService'
import { ObservationImageStore } from '../../../src/main/workbench/observation/ObservationImageStore'
import { createBlankCourseProjectV10 } from '../../../src/core/course/createCourseProjectV10'
import { WEB_DEFINITION } from '../../../src/components/web/data'
import { componentProjectFiles } from '../../../src/core/projectFiles/componentPlatform'
import { captureComponentOperation } from '../../../src/core/drivers/courseV10Operations'

const directory = process.env.OBSERVATION_AUDIT_ROOT!
app.setPath('userData', join(directory, 'profile'))
registerPrivilegedSchemes()
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.whenReady().then(() => {
  const driver = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } })
  void driver.loadURL('data:text/html,Observation%20driver')
  ;(globalThis as any).runObservationAudit = async () => {
    const host = new DocumentHostService(join(directory, 'recovery'))
    const desktop = new ViewObservationDesktopService({ rendererEntryUrl: process.env.OBSERVATION_AUDIT_URL!, compilation: host.compilation })
    const images = new ObservationImageStore()
    const service = new ViewObservationService({ snapshot: host.internalAPI.read, captureIsolated: desktop.captureIsolated, images })
    host.tools.configureHostServices({ observations: service })
    const project = createBlankCourseProjectV10('Observation target proof')
    project.definitions[WEB_DEFINITION.id] = WEB_DEFINITION
    const html = (text: string, color: string) => `<div style="height:100%;display:grid;place-items:center;background:${color};color:white;font:700 64px sans-serif">${text}</div>`
    const first = project.surfaces[0]
    first.title = 'FIRST RED'; first.childIds = ['red-content']; first.designSize = { width: 800, height: 450 }
    project.surfaces.push({ id: 'second', kind: 'slide', title: 'SECOND BLUE', childIds: ['blue-content'], designSize: { width: 800, height: 450 } })
    for (const [id, text, color] of [['red-content', 'FIRST RED', '#b91c1c'], ['blue-content', 'SECOND BLUE', '#1d4ed8']]) {
      project.instances[id] = { id, definitionId: WEB_DEFINITION.id, data: { html: html(text, color) }, frame: { width: 800, height: 450, transform: [1, 0, 0, 1, 0, 0] } }
    }
    const opened = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'observe.h5lesson')
    const runId = 'observation-audit'
    await host.tools.beginRun({ runId, actor: 'agent', documents: [{ documentId: opened.documentId, writable: [{ kind: 'document' }] }], fileAccess: { permission: 'workspace', workspaceRoot: directory } })
    await host.tools.loadToolFamilies(runId, ['content'])
    const observations: unknown[] = []
    const observe = async (surfaceId: string, name: string) => {
      const snapshot = await host.internalAPI.read(opened.documentId)
      if (snapshot.model.kind !== 'course-v10') throw new Error('Expected V10')
      const file = componentProjectFiles(snapshot.model.project, snapshot.model.resources).find(file => file.kind === 'structure' && file.target?.kind === 'container' && file.target.container.kind === 'surface' && file.target.container.surfaceId === surfaceId)
      if (!file) throw new Error(`Page path unavailable: ${surfaceId}`)
      const result = await host.tools.execute(runId, name, { name: 'view.observe', input: { path: file.path } })
      if (result.kind !== 'read') throw new Error(JSON.stringify(result))
      const data = result.data as any
      const resource = await service.readResource({ runId, resourceId: data.image.resourceId })
      await writeFile(join(directory, `${name}.png`), resource.bytes)
      observations.push({ name, path: file.path, ...data, windowCount: BrowserWindow.getAllWindows().length })
    }
    try {
      await observe('second', '01-second-blue')
      await observe(first.id, '02-first-red')
      const before = await host.internalAPI.read(opened.documentId)
      if (before.model.kind !== 'course-v10') throw new Error('Expected V10')
      const commit = await host.internalAPI.dispatch({ documentId: opened.documentId, epoch: opened.epoch, baseRevision: before.revision,
        operationId: 'change-blue', requestDigest: 'observation-audit-change', actor: 'human', mutation: { type: 'command', command:
          captureComponentOperation(before.model.project, [{ type: 'data.set', instanceId: 'blue-content', path: ['html'], value: html('SECOND GREEN UPDATED', '#15803d') }]) } })
      if (commit.status !== 'applied') throw new Error(JSON.stringify(commit))
      await observe('second', '03-second-green-updated')
      const result = { observations, commit, electron: process.versions.electron, chrome: process.versions.chrome, windowCount: BrowserWindow.getAllWindows().length, modelCalls: 0 }
      await writeFile(join(directory, 'result.json'), JSON.stringify(result, null, 2))
      return result
    } finally { await host.tools.stop(runId); await host.operate({ type: 'close', documentId: opened.documentId, discardDirty: true }) }
  }
})
