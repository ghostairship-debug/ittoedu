import { BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DocumentHostService } from '../../../src/main/workbench/DocumentHostService'
import { HtmlActionDesktopPort } from '../../../src/main/workbench/observation/HtmlActionDesktopPort'
import { HtmlActionService, type PublishedActionObservation } from '../../../src/main/workbench/observation/HtmlActionService'
import { ViewObservationDesktopService } from '../../../src/main/workbench/observation/ViewObservationDesktopService'
import { ViewObservationService } from '../../../src/main/workbench/observation/ViewObservationService'
import { ObservationImageStore } from '../../../src/main/workbench/observation/ObservationImageStore'
import { componentProjectFiles } from '../../../src/core/projectFiles/componentPlatform'
import { captureComponentOperation } from '../../../src/core/drivers/courseV10Operations'
import type { DocumentModel } from '../../../src/shared/workbench/document'

/** The ordinary Published action owners operate a disposable document copy. */
export async function auditProgramActions(directory: string, rendererEntryUrl: string,
  model: Extract<DocumentModel, { kind: 'course-v10' }>) {
  const host = new DocumentHostService(join(directory, 'program-actions-recovery'))
  const desktop = new ViewObservationDesktopService({ rendererEntryUrl, compilation: host.compilation, snapshot: host.internalAPI.read })
  const images = new ObservationImageStore()
  const actions = new HtmlActionService({ published: desktop, frames: new HtmlActionDesktopPort(), images,
    preview: { automationContext: async () => { throw new Error('Expected a Published context') },
      automationContextForDocument: async () => { throw new Error('Expected a Published context') } } })
  const observations = new ViewObservationService({ snapshot: host.internalAPI.read, captureIsolated: desktop.captureIsolated, images,
    observeInteractive: ({ runId, identity, snapshot, projectId, signal }) =>
      actions.observePublished(runId, { identity: { ...identity, projectId }, snapshot, signal }) })
  host.tools.configureHostServices({ observations: {
    observe: input => observations.observe(input),
    actionIdentity: runId => { try { return actions.publishedIdentity(runId) } catch { return null } },
    click: ({ runId, ...input }) => actions.clickPublished(runId, input),
    input: ({ runId, ...input }) => actions.inputPublished(runId, input),
    readResource: input => observations.readResource(input),
    stopRun: async runId => { actions.stopRun(runId); await observations.stopRun(runId) },
  } })
  const opened = await host.internalAPI.create(structuredClone(model), 'program-actions.h5lesson')
  const runId = 'program-action-audit'
  let started = false, stopped = false
  const steps: Array<PublishedActionObservation & { name: string; windowCount: number; hostGeometry: {
    innerSize: { width: number; height: number }; visualViewport: { width: number; height: number; scale: number };
    rootRect: { x: number; y: number; width: number; height: number }; devicePixelRatio: number;
    contentSize: number[]; contentBounds: { x: number; y: number; width: number; height: number }; zoomFactor: number;
    pngSize: { width: number; height: number };
  } }> = []
  const remember = async (name: string, observation: PublishedActionObservation) => {
    const resource = await observations.readResource({ runId, resourceId: observation.image.resourceId })
    await writeFile(join(directory, `${name}.png`), resource.bytes)
    const windows = BrowserWindow.getAllWindows().filter(window => window.webContents.getURL() === new URL('observation.html', rendererEntryUrl).href)
    if (windows.length !== 1) throw new Error(`Expected one owned Published observation window, got ${windows.length}`)
    const window = windows[0]!, png = Buffer.from(resource.bytes)
    const renderer = await window.webContents.executeJavaScript(`(() => {
      const root = document.getElementById('observation-root');
      if (!root) throw new Error('Published observation root missing');
      const rect = root.getBoundingClientRect();
      return { innerSize: {width:innerWidth,height:innerHeight},
        visualViewport: {width:visualViewport?.width??innerWidth,height:visualViewport?.height??innerHeight,scale:visualViewport?.scale??1},
        rootRect: {x:rect.x,y:rect.y,width:rect.width,height:rect.height},devicePixelRatio };
    })()`)
    steps.push({ name, ...observation, windowCount: BrowserWindow.getAllWindows().length, hostGeometry: { ...renderer,
      contentSize: window.getContentSize(), contentBounds: window.getContentBounds(), zoomFactor: window.webContents.getZoomFactor(),
      pngSize: { width: png.readUInt32BE(16), height: png.readUInt32BE(20) } } })
    return observation
  }
  const observe = async (locationId: string, name: string) => {
    const snapshot = await host.internalAPI.read(opened.documentId)
    if (snapshot.model.kind !== 'course-v10') throw new Error('Expected component project')
    const file = componentProjectFiles(snapshot.model.project, snapshot.model.resources).find(file =>
      file.kind === 'structure' && file.target?.kind === 'container' && file.target.container.kind === 'surface' && file.target.container.surfaceId === locationId
      || file.kind === 'html' && file.target?.kind === 'instance' && file.target.instanceId === locationId)
    if (!file) throw new Error(`Observation path unavailable: ${locationId}`)
    const result = await host.tools.execute(runId, name, { name: 'view.observe', input: { path: file.path } })
    if (result.kind !== 'read') throw new Error(JSON.stringify(result))
    return remember(name, result.data as PublishedActionObservation)
  }
  const button = (observation: PublishedActionObservation) => {
    const found = observation.elements.find(element => element.label.startsWith('继续实验'))
    if (!found) throw new Error(`Program button not observed: ${JSON.stringify(observation.elements)}`)
    return found
  }
  try {
    await host.tools.beginRun({ runId, actor: 'agent', documents: [{ documentId: opened.documentId, writable: [{ kind: 'document' }] }],
      fileAccess: { permission: 'workspace', workspaceRoot: directory } })
    started = true
    await host.tools.loadToolFamilies(runId, ['content'])
    const before = await host.internalAPI.read(opened.documentId)
    const initial = await observe('program-root', '06-program-interactive')
    const clicked = await host.tools.execute(runId, 'program-button-click', { name: 'view.click', input: { handle: button(initial).handle } })
    if (clicked.kind !== 'read') throw new Error(JSON.stringify(clicked))
    const afterClick = await remember('07-program-after-click', clicked.data as PublishedActionObservation)
    const reread = await observe('program-root', '08-program-reread')
    await observe('second', '09-mixed-slide')
    const returned = await observe('program-root', '10-mixed-program')
    const afterActions = await host.internalAPI.read(opened.documentId)
    if (afterActions.model.kind !== 'course-v10') throw new Error('Expected component project')
    const authorUnchangedByActions = before.epoch === afterActions.epoch && before.revision === afterActions.revision
      && JSON.stringify(before.model) === JSON.stringify(afterActions.model)
    const previousHtml = String(afterActions.model.project.instances['program-root']!.data.html)
    const commit = await host.internalAPI.dispatch({ documentId: opened.documentId, epoch: opened.epoch, baseRevision: afterActions.revision,
      operationId: 'program-source-update', requestDigest: 'program-action-audit-source-update', actor: 'human', mutation: { type: 'command', command:
        captureComponentOperation(afterActions.model.project, [{ type: 'data.set', instanceId: 'program-root', path: ['html'], value: `${previousHtml}<!-- revised source -->` }]) } })
    if (commit.status !== 'applied') throw new Error(JSON.stringify(commit))
    const staleAction = await host.tools.execute(runId, 'stale-program-button-click', { name: 'view.click', input: { handle: button(returned).handle } })
    const revised = await observe('program-root', '11-program-revised-source')
    await host.tools.stop(runId)
    stopped = true
    return { observations: steps, authorUnchangedByActions, commit, staleAction,
      labels: [initial, afterClick, reread, revised].map(value => button(value).label),
      windowCountAfterStop: BrowserWindow.getAllWindows().length }
  } finally {
    if (started && !stopped) await host.tools.stop(runId)
    actions.dispose(); desktop.dispose()
    await host.operate({ type: 'close', documentId: opened.documentId, discardDirty: true })
  }
}
