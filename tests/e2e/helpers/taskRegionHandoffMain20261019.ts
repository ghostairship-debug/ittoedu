import { testContainerInstance } from '../../helpers/glxWorkFixture'
import { app, BrowserWindow, webContents } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { registerPrivilegedSchemes } from '../../../src/main/protocols'
import { TaskHtmlPreview } from '../../../src/main/workbench/observation/TaskHtmlPreview'
import { HtmlActionService } from '../../../src/main/workbench/observation/HtmlActionService'
import { HtmlActionDesktopPort } from '../../../src/main/workbench/observation/HtmlActionDesktopPort'
import { ObservationImageStore } from '../../../src/main/workbench/observation/ObservationImageStore'
import { createBlankCourseProjectV10 } from '../../../src/core/course/createCourseProjectV10'
import { CourseV10Driver } from '../../../src/core/drivers/CourseV10Driver'
import { DocumentSession } from '../../../src/core/documents/DocumentSession'
import { TEXT_DEFINITION } from '../../../src/components/text/adapters'
import { createTextComponentData } from '../../../src/components/text/data'
import { jsonValueSchema } from '../../../src/shared/contracts/component-platform'
import { ComponentProjectFileCoordinator, type ComponentProjectSnapshot } from '../../../src/core/projectFiles/componentPlatform/coordinator'
import { ContentApplyService } from '../../../src/main/workbench/contentApply/applyService'
import { measureHtmlAtDesignViewport } from '../../../src/main/workbench/contentApply/measurement/ElectronHtmlDesignMeasurement'
import { artifactGroupInput } from '../../../src/core/tools/artifactGroup'
import type { DocumentSnapshot } from '../../../src/shared/workbench/document'

const directory = process.env.TASK_REGION_FIXTURE_DIR!, root = process.env.TASK_REGION_FIXTURE_ROOT!
if (!directory || !root) throw new Error('Missing isolated task region fixture directory')
app.setPath('userData', path.join(directory, 'profile'))
registerPrivilegedSchemes()
void app.whenReady().then(async () => {
  const anchor = new BrowserWindow({ show: false, width: 160, height: 100,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  await anchor.loadURL('about:blank')
})

Reflect.set(globalThis, 'runTaskRegionHandoff', async () => {
  await app.whenReady()
  const html = await fs.readFile(path.join(root, 'tests/fixtures/contentLocalRegion20261019.html'), 'utf8')
  const candidatePath = path.join(directory, 'candidate.html')
  await fs.writeFile(candidatePath, html)
  const project = createBlankCourseProjectV10('Frozen region handoff'), surface = testContainerInstance(project, 0)
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  project.instances.heading = { id: 'heading', definitionId: TEXT_DEFINITION.id,
    data: jsonValueSchema.parse(createTextComponentData('Native heading remains')),
    frame: { width: 1120, height: 150, transform: [1, 0, 0, 1, 56, 0] } }
  surface.childIds = ['heading']
  const heading = structuredClone(project.instances.heading), driver = new CourseV10Driver()
  const session = await DocumentSession.create({ documentId: 'formal-doc', epoch: 'formal-epoch',
    binding: { kind: 'file', path: path.join(directory, 'formal.glx'), version: null, bindingVersion: 0 },
    model: { kind: 'course-v10', project, resources: { assets: {}, components: {} } } }, driver,
  { async append() {}, async save(input) { if (input.binding.kind !== 'file') throw new Error('File binding required'); return input.binding } })
  const snapshot = () => session.read() as ComponentProjectSnapshot
  let serial = 0, frozen: unknown = null
  const measured: { width: number; height: number }[] = [], prepared: { width: number; height: number }[] = []
  const coordinator = new ComponentProjectFileCoordinator({
    document: async () => snapshot(),
    source: async () => artifactGroupInput('candidate.html', [{ name: 'candidate.html', bytes: new TextEncoder().encode(html) }], { targetContext: frozen }),
    prepareSource: async (input, file) => { prepared.push(file.programViewport!); return { kind: 'html', html: input.text! } },
    async apply(_run, operationId, _digest, baseline, request) {
      return new ContentApplyService({ createId: () => `adopted-${++serial}`,
        compilation: { async compile() { throw new Error('Builtin web must retain its existing implementation') } },
        measure: input => { measured.push(input.viewport); return measureHtmlAtDesignViewport(input) },
        session: { project: () => baseline.model.project,
          dispatch: command => session.execute({ documentId: baseline.documentId, epoch: baseline.epoch, baseRevision: baseline.revision,
            operationId, actor: 'agent', mutation: { type: 'command', command } }) } }).apply(request)
    },
  })
  const listed = await coordinator.execute('parent', 'list', 'list', 'project.list', {})
  if (listed.kind !== 'read') throw new Error('Current target required')
  const targetPath = (listed.data as { files: { path: string; type: string }[] }).files.find(file => file.type === 'structure')!.path
  const region = { width: 640, height: 360, transform: [1, 0, 0, 1, 320, 180] as [number, number, number, number, number, number] }
  frozen = await coordinator.taskTargetContext('parent', { path: targetPath, region })
  const candidate: DocumentSnapshot = { documentId: 'candidate-doc', epoch: 'candidate-epoch', revision: 0,
    binding: { kind: 'file', path: candidatePath, version: null, bindingVersion: 0 },
    model: { kind: 'text', source: html, resources: { assets: {}, components: {} } },
    dirty: true, saving: false, recoverable: true, undoDepth: 0, redoDepth: 0 }
  const preview = new TaskHtmlPreview({ readDocument: async () => candidate,
    agentBundlePath: path.join(root, 'dist-renderer/html-preview-agent.iife.js'), taskTargetContext: async () => frozen })
  const frames = new HtmlActionDesktopPort(), originalFrameToken = frames.frameToken.bind(frames)
  let failFrameToken = false
  frames.frameToken = async context => { if (failFrameToken) { failFrameToken = false; throw new Error('Fixture: resized frame identity unavailable once') } return originalFrameToken(context) }
  const actions = new HtmlActionService({ preview, frames, images: new ObservationImageStore() })
  const baselineWindows = BrowserWindow.getAllWindows().length
  try {
    await actions.beginDocumentRun('child', { documentId: candidate.documentId, epoch: candidate.epoch, revision: candidate.revision })
    const observed = await actions.observe('child')
    const context = await preview.automationContextForDocument({ documentId: candidate.documentId, epoch: candidate.epoch, revision: 0, runId: 'child' })
    const frame = webContents.fromId(context.webContentsId)!.mainFrame.framesInSubtree.find(frame => frame.url === context.lease.url)!
    const geometry = await frame.executeJavaScript(`(() => {const a=document.getElementById('stage').getBoundingClientRect(),b=document.getElementById('vw').getBoundingClientRect();return {viewport:{width:innerWidth,height:innerHeight},stage:{width:a.width,height:a.height},vw:{width:b.width,height:b.height}}})()`)
    const clicked = await actions.click('child', { operationId: 'actual-click', handle: observed.elements.find(element => element.label === '运行')!.handle })
    const feedback = await frame.executeJavaScript(`document.getElementById('feedback').textContent`)
    await fs.writeFile(path.join(directory, 'candidate-clicked.png'), (await actions.readResource('child', clicked.image.resourceId)).bytes)
    const documentTarget = { documentId: candidate.documentId, epoch: candidate.epoch, revision: 0 }
    const resized = await actions.executeDocumentAction('child', documentTarget, { name: 'html.observe', input: { viewport: { width: 400, height: 300 } } })
    const again = await actions.executeDocumentAction('child', documentTarget, { name: 'html.observe', input: {} })
    let oldHandleRejected = false, spentRejected = false
    try { await actions.click('child', { operationId: 'after-size-old', handle: clicked.elements[0]!.handle }) } catch { oldHandleRejected = true }
    try { await actions.click('child', { operationId: 'actual-click', handle: 'unused' }) } catch { spentRejected = true }
    const resizedFrame = await frame.executeJavaScript(`({width:innerWidth,height:innerHeight,feedback:document.getElementById('feedback').textContent})`)
    const resizeFacts = { viewport: 'viewport' in resized ? resized.viewport : undefined, repeatedViewport: 'viewport' in again ? again.viewport : undefined,
      actual: resizedFrame, oldHandleRejected, spentRejected, sameContext: (await preview.automationContextForDocument({ ...documentTarget, runId:'child' })).lease.loadId === context.lease.loadId }
    failFrameToken = true
    let resizeFailureRetired = false
    try { await actions.executeDocumentAction('child', documentTarget, { name: 'html.observe', input: { viewport: { width: 500, height: 320 } } }) }
    catch (error) { resizeFailureRetired = String(error).includes('Fixture: resized frame identity unavailable once') }
    const recovered = await actions.executeDocumentAction('child', documentTarget, { name: 'html.observe', input: {} })
    candidate.revision = 1
    if (candidate.model.kind === 'text') candidate.model.source += '\n<!-- new canonical revision -->'
    const afterRevision = await actions.executeDocumentAction('child', { ...documentTarget, revision: 1 }, { name: 'html.observe', input: {} })
    const viewportRecovery = { resizeFailureRetired, recovered: 'viewport' in recovered ? recovered.viewport : undefined,
      afterRevision: 'viewport' in afterRevision ? afterRevision.viewport : undefined }
    const before = snapshot()
    const result = await coordinator.execute('parent', 'adopt', 'adopt', 'project.apply', { path: targetPath, intent: 'insert', from: 'delegate-fixture@candidate.html' })
    if (result.kind !== 'read' || (result.data as { commit?: string }).commit !== 'committed') throw new Error(`Adoption did not commit: ${JSON.stringify(result)}`)
    const receipt = result.data as { insertedIds: string[]; frame: unknown; viewport: unknown }
    const current = snapshot(), id = receipt.insertedIds[0]!, instance = current.model.project.instances[id]!
    const archive = path.join(directory, 'adopted.glx')
    await fs.writeFile(archive, driver.serialize(current.model))
    const reopened = driver.load(new Uint8Array(await fs.readFile(archive)))
    if (reopened.kind !== 'course-v10') throw new Error('Saved formal carrier required')
    const preservedHeading = JSON.stringify(current.model.project.instances.heading) === JSON.stringify(heading)
    const formalFrame = instance.frame, reopenedFrame = reopened.project.instances[id]!.frame
    const undoDepth = current.undoDepth - before.undoDepth
    const undo = await session.execute({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
      operationId: 'undo-adoption', actor: 'human', mutation: { type: 'undo' } })
    actions.stopRun('child')
    return { geometry, feedback, source: observed.source, region, prepared, measured, formalFrame, reopenedFrame, resizeFacts, viewportRecovery,
      receipt: { frame: receipt.frame, viewport: receipt.viewport }, preservedHeading, undoDepth,
      undo: undo.status, undoPreservedHeading: isDeepStrictEqual(snapshot().model.project.instances, before.model.project.instances),
      undoInstances: { before: before.model.project.instances, after: snapshot().model.project.instances },
      windowsRestored: BrowserWindow.getAllWindows().length === baselineWindows }
  } finally { actions.stopRun('child'); preview.dispose() }
})
