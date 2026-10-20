import { app, BrowserWindow, nativeImage } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { registerPrivilegedSchemes } from '../../../src/main/protocols'
import { createBlankCourseProjectV10 } from '../../../src/core/course/createCourseProjectV10'
import { componentEnhancementRuntimeSource, componentEnhancementWrapperSource } from '../../../src/core/components/source/componentEnhancement'
import rainRangeFixture from '../../fixtures/html-range-state-repaint/rainfall.json'
import { HtmlActionService, type PublishedActionObservation } from '../../../src/main/workbench/observation/HtmlActionService'
import { HtmlActionDesktopPort } from '../../../src/main/workbench/observation/HtmlActionDesktopPort'
import { ObservationImageStore } from '../../../src/main/workbench/observation/ObservationImageStore'
import { ViewObservationDesktopService } from '../../../src/main/workbench/observation/ViewObservationDesktopService'
import type { ViewObservationSnapshot } from '../../../src/shared/workbench/viewObservation'

const directory = process.env.VIEW_ACTIONS_FIXTURE_DIR!
if (!directory) throw new Error('Missing isolated view-actions fixture directory')
app.setPath('userData', path.join(directory, 'profile'))
app.on('window-all-closed', () => {})
registerPrivilegedSchemes()

Reflect.set(globalThis, 'runPublishedViewActions', async () => {
  await app.whenReady()
  const baselineWindows = BrowserWindow.getAllWindows().length
  const project = createBlankCourseProjectV10('Published action fixture')
  project.surfaces = ['first', 'second'].map(id => ({ id, kind: 'slide', title: id, childIds: [], designSize: { width: 800, height: 500 } }))
  project.surfaces[1]!.designSize = { width: 960, height: 540 }
  project.definitions.lab = { id: 'lab', role: 'content', implementation: { kind: 'source', language: 'javascript', source: `
export default { document: 'web', mount({ root }) {
  root.style.cssText = 'box-sizing:border-box;background:#f0f6ff;padding:32px;color:#132742;font:22px Arial;min-height:300px';
  root.innerHTML = '<h1>Persistent experiment</h1><button aria-label="Add">Add</button><button aria-label="Clear">Clear</button><p><input aria-label="Answer" placeholder="Answer"></p><p><input aria-label="Power" type="range" min="0" max="10" step="1" value="0"></p><output></output><span aria-label="Paint state" style="display:block;width:20px;height:20px"></span>';
  const button=root.querySelector('button'), clearButton=root.querySelector('button[aria-label="Clear"]'), text=root.querySelector('input[aria-label="Answer"]'), range=root.querySelector('input[aria-label="Power"]'), output=root.querySelector('output'), swatch=root.querySelector('span');
  let clicks=0, clickTrusted=false, inputTrusted=false, rangeTrusted=false;
  const paint=()=>{output.textContent='State: clicks='+clicks+'; answer='+text.value+'; power='+range.value+'; trusted='+clickTrusted+'/'+inputTrusted+'/'+rangeTrusted;swatch.style.background=range.value==='7'?'#00ff00':'#ff0000'};
  const click=event=>{clicks++;clickTrusted=event.isTrusted;paint()};
  const input=event=>{inputTrusted=event.isTrusted;paint()};
  const slide=event=>{rangeTrusted=event.isTrusted;paint()};
  const clear=()=>{root.replaceChildren();root.style.background='transparent'};
  button.addEventListener('click',click);clearButton.addEventListener('click',clear);text.addEventListener('input',input);range.addEventListener('input',slide);paint();
  return { update() {}, dispose() { button.removeEventListener('click',click);clearButton.removeEventListener('click',clear);text.removeEventListener('input',input);range.removeEventListener('input',slide);root.replaceChildren(); } };
} };` } }
  project.instances.lab = { id: 'lab', definitionId: 'lab', data: {}, frame: { width: 730, height: 430, transform: [1, 0, 0, 1, 25, 25] } }
  project.surfaces[0]!.childIds = ['lab']
  const snapshot: ViewObservationSnapshot = { documentId: 'fixture', epoch: 'fixture-epoch', revision: 0,
    model: { kind: 'course-v10', project, resources: { assets: {}, components: {} } }, binding: { kind: 'untitled', suggestedName: 'fixture.h5lesson' },
    dirty: true, saving: false, recoverable: true, undoDepth: 0, redoDepth: 0 }
  const published = new ViewObservationDesktopService({ rendererEntryUrl: 'courseware-editor://app/index.html', snapshot: async () => snapshot })
  const frames = new HtmlActionDesktopPort()
  const trace = (event: unknown) => { void fs.appendFile(path.join(directory, 'progress.jsonl'), JSON.stringify({ time: Date.now(), event }) + '\n') }
  const actions = new HtmlActionService({ preview: { async automationContext() { throw new Error('No HTML preview in fixture') },
    async automationContextForDocument() { throw new Error('No HTML preview in fixture') } },
    published, frames, images: new ObservationImageStore(directory) })
  const target = (locationId = 'first') => ({ snapshot, identity: { documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision,
    projectId: project.id, locationId, stateId: null } })
  const state = (observation: PublishedActionObservation) => observation.elements.find(element => element.tag === 'output' && element.text.startsWith('State:'))?.text
  const viewport = async (observation: PublishedActionObservation) => {
    const window = BrowserWindow.getAllWindows().find(value => !value.isDestroyed())!
    return { visible: window.isVisible(), observed: observation.observationScope?.viewport, contentSize: window.getContentSize(),
      actual: await window.webContents.mainFrame.executeJavaScript('({width:innerWidth,height:innerHeight,scale:devicePixelRatio})') }
  }
  const save = async (name: string, observation: PublishedActionObservation) => {
    const filename = path.join(directory, name)
    await fs.writeFile(filename, (await actions.readResource('fixture-run', observation.image.resourceId)).bytes)
    return filename
  }
  const paintedColor = async (observation: PublishedActionObservation) => {
    const painted = nativeImage.createFromBuffer(Buffer.from((await actions.readResource('fixture-run', observation.image.resourceId)).bytes))
    const swatch = observation.elements.find(element => element.tag === 'span' && element.label === 'Paint state')!
    const size = painted.getSize(), scale = size.width / observation.observationScope!.viewport!.width
    const pixel = (Math.floor((swatch.rect.y + swatch.rect.height / 2) * scale) * size.width
      + Math.floor((swatch.rect.x + swatch.rect.width / 2) * scale)) * 4
    return [...painted.toBitmap().subarray(pixel, pixel + 4)]
  }
  const green = (color: number[]) => color[0] === 0 && color[1] === 255 && color[2] === 0
  try {
    const first = await actions.observePublished('fixture-run', target())
    const hostBootstrapShortUrl = BrowserWindow.getAllWindows().some(window =>
      window.webContents.mainFrame.framesInSubtree.some(frame => {
        const url = new URL(frame.url)
        return url.pathname.includes('/bootstrap/') && url.search === ''
      }))
    const firstViewport = await viewport(first)
    const beforeImage = await save('before.png', first)
    const add = first.elements.find(element => element.tag === 'button' && element.label === 'Add')!
    const clicked = await actions.clickPublished('fixture-run', { operationId: 'add-once', handle: add.handle })
    const repeat = await actions.clickPublished('fixture-run', { operationId: 'add-once', handle: add.handle })
    const filled = await actions.inputPublished('fixture-run', { operationId: 'answer',
      handle: clicked.elements.find(element => element.tag === 'input' && element.label === 'Answer')!.handle, value: 'actual input' })
    const adjusted = await actions.inputPublished('fixture-run', { operationId: 'power',
      handle: filled.elements.find(element => element.tag === 'input' && element.label === 'Power')!.handle, value: '7' })
    const afterImage = await save('after-input.png', adjusted)
    const color = await paintedColor(adjusted), paintedPower7 = green(color)
    const windowCount = BrowserWindow.getAllWindows().length
    trace({ type: 'observe.second.begin' })
    const second = await actions.observePublished('fixture-run', target('second'))
    trace({ type: 'observe.second.end' })
    const secondViewport = await viewport(second)
    const returned = await actions.observePublished('fixture-run', target())
    trace({ type: 'observe.returned.end' })
    const returnedViewport = await viewport(returned)
    const returnedImage = await save('returned.png', returned)
    const returnedColor = await paintedColor(returned), returnedPaintedPower7 = green(returnedColor)
    const sameWorker = first.identity.viewGeneration === second.identity.viewGeneration && first.identity.viewGeneration === returned.identity.viewGeneration
    const oneWindowForPages = windowCount === BrowserWindow.getAllWindows().length
    published.releaseDocument(snapshot.documentId)
    let closedTargetRejected = false
    try { await actions.clickPublished('fixture-run', { operationId: 'closed-target', handle: returned.elements.find(element => element.tag === 'button' && element.label === 'Add')!.handle }) }
    catch { closedTargetRejected = true }
    const reopened = await actions.observePublished('fixture-run', target())
    let spentRejected = false
    try { await actions.clickPublished('fixture-run', { operationId: 'add-once', handle: reopened.elements.find(element => element.tag === 'button' && element.label === 'Add')!.handle }) }
    catch { spentRejected = true }
    const empty = await actions.clickPublished('fixture-run', { operationId: 'clear-empty',
      handle: reopened.elements.find(element => element.tag === 'button' && element.label === 'Clear')!.handle })
    const emptyFrameSkipped = empty.observationScope?.frames.some(frame => frame.status === 'not-visible' && frame.reason === 'empty-paint') === true
    actions.stopRun('fixture-run')
    let stopRejected = false
    try { await actions.observePublished('fixture-run', target()) } catch { stopRejected = true }
    return { source: first.source, first: state(first), clicked: state(clicked), adjusted: state(adjusted), returned: state(returned), reopened: state(reopened),
      secondLocation: second.identity.locationId, returnedLocation: returned.identity.locationId,
      sameWorker, oneWindowForPages, paintedPower7, paintedColor: color, returnedPaintedPower7, returnedColor,
      firstImage: first.coverage, secondImage: second.coverage, returnedImageSize: returned.coverage,
      viewports: { first: firstViewport, second: secondViewport, returned: returnedViewport },
      repeatedOnlyOnce: repeat.generation === clicked.generation, newWorkerAfterClose: reopened.identity.viewGeneration !== first.identity.viewGeneration,
      nestedFrames: adjusted.observationScope?.frames.filter(frame => frame.status === 'observed').length,
      hostBootstrapShortUrl,
      reportedFrameUrls: [first, clicked, filled, adjusted, second, returned, reopened, empty]
        .flatMap(observation => observation.observationScope?.frames.map(frame => frame.url) ?? []),
      closedTargetRejected, spentRejected, stopRejected, emptyFrameSkipped, windowsRestored: BrowserWindow.getAllWindows().length === baselineWindows,
      document: { revision: snapshot.revision, undoDepth: snapshot.undoDepth, data: snapshot.model.project.instances.lab.data },
      screenshots: { beforeImage, afterImage, returnedImage } }
  } catch (error) {
    const windows = await Promise.all(BrowserWindow.getAllWindows().map(async window => {
      const focused = window.webContents.focusedFrame
      return { id: window.id, focusedFrame: focused && { processId: focused.processId, frameToken: focused.frameToken },
        frames: await Promise.all(window.webContents.mainFrame.framesInSubtree.map(async frame => ({ processId: frame.processId,
          frameToken: frame.frameToken, state: await frame.executeJavaScript(`({url:location.origin+location.pathname,hasFocus:document.hasFocus(),
            active:document.activeElement&&{tag:document.activeElement.localName,label:document.activeElement.getAttribute('aria-label')},
            state:document.querySelector('output')?.textContent})`).catch(String) }))) }
    }))
    await fs.writeFile(path.join(directory, 'failure.json'), JSON.stringify({ error: String(error), windows }, null, 2))
    throw error
  } finally { actions.stopRun('fixture-run'); published.dispose() }
})

Reflect.set(globalThis, 'runPublishedRainRangeRegression', async () => {
  await app.whenReady()
  // Frozen author HTML/Source, with the current enhancement and sandbox state bridge.
  // The small base only mounts that HTML; no generated project or user file is edited.
  const project = createBlankCourseProjectV10('Rainfall state repaint regression')
  project.definitions.base = { id: 'base', role: 'mixed', implementation: { kind: 'source', language: 'javascript', source: `
export default { document: 'web', mount({root,instance}) {
  root.innerHTML=instance.data.html;
  return {update(){},dispose(){root.replaceChildren()}};
}};` } }
  project.definitions.logic = { id: 'logic', role: 'mixed', implementation: { kind: 'source', language: 'javascript', source: rainRangeFixture.enhancementSource } }
  project.definitions.enhancement = { id: 'enhancement', role: 'mixed', implementation: { kind: 'source', language: 'javascript', source: componentEnhancementRuntimeSource } }
  project.definitions.lab = { id: 'lab', role: 'mixed', implementation: { kind: 'source', language: 'javascript', source: componentEnhancementWrapperSource,
    moduleBindings: { './implementation': 'base', './enhancement': 'logic', './enhancement-runtime': 'enhancement' } } }
  project.instances.lab = { id: 'lab', definitionId: 'lab', data: { html: rainRangeFixture.html }, frame: { width: 1168, height: 425, transform: [1, 0, 0, 1, 56, 177] } }
  const surface = project.surfaces[0]!
  surface.childIds = ['lab']
  const snapshot: ViewObservationSnapshot = { documentId: 'rain-range-fixture', epoch: 'fixture-epoch', revision: project.revision,
    model: { kind: 'course-v10', project, resources: { assets: {}, components: {} } }, binding: { kind: 'untitled', suggestedName: 'fixture.h5lesson' },
    dirty: false, saving: false, recoverable: true, undoDepth: 0, redoDepth: 0 }
  const published = new ViewObservationDesktopService({ rendererEntryUrl: 'courseware-editor://app/index.html', snapshot: async () => snapshot })
  const actions = new HtmlActionService({ preview: { async automationContext() { throw new Error('No HTML preview in fixture') },
    async automationContextForDocument() { throw new Error('No HTML preview in fixture') } },
    published, frames: new HtmlActionDesktopPort(), images: new ObservationImageStore(directory) })
  const target = { snapshot, identity: { documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision,
    projectId: project.id, locationId: surface.id, stateId: null } }
  try {
    const first = await actions.observePublished('rain-range-run', target)
    const window = BrowserWindow.getAllWindows().find(value => !value.isDestroyed())!
    const candidates = await Promise.all(window.webContents.mainFrame.framesInSubtree.map(async frame => ({ frame,
      rainfall: await frame.executeJavaScript('Boolean(document.querySelector("#rain-p"))').catch(() => false) })))
    const frame = candidates.find(value => value.rainfall)?.frame
    if (!frame) throw new Error('Missing actual rainfall input frame')
    await frame.executeJavaScript(`(() => {
      const range=document.querySelector('#rain-p'), descriptor=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');
      document.querySelector('#bar-in').parentElement.setAttribute('aria-label','Water balance paint');
      const trace=window.__rainRangeTrace=[];
      const record=event=>trace.push({time:performance.now(),...event});
      Object.defineProperty(range,'value',{configurable:true,get(){return descriptor.get.call(this)},set(value){
        record({type:'script-value',before:descriptor.get.call(this),value:String(value)});descriptor.set.call(this,value);
      }});
      for(const type of ['keydown','keyup','input','change'])range.addEventListener(type,event=>record({
        type,key:event.key,value:range.value,trusted:event.isTrusted,active:document.activeElement===range
      }),true);
    })()`)
    const attempts: Array<{ error: { message: string; code?: string } | null; value: string; trace: unknown[] }> = []
    let observation = first
    for (let attempt = 0; attempt < 12; attempt++) {
      await frame.executeJavaScript('window.__rainRangeTrace.length=0')
      let error: { message: string; code?: string } | null = null
      try { observation = await actions.inputPublished('rain-range-run', { operationId: 'rain-40-' + attempt,
        handle: observation.elements.find(element => element.tag === 'input' && element.label === '降雨量P毫米')!.handle, value: '40' }) }
      catch (cause) { error = { message: String(cause), code: (cause as { code?: string }).code } }
      const actual = await frame.executeJavaScript(`({value:document.querySelector('#rain-p').value,
        formula:document.querySelector('#formula').textContent,total:document.querySelector('#total').textContent,
        infiltration:document.querySelector('#infil').textContent,runoff:document.querySelector('#runoff').textContent,
        trace:window.__rainRangeTrace})`) as { value: string; formula: string; total: string; infiltration: string; runoff: string; trace: unknown[] }
      attempts.push({ error, ...actual })
      if (error) break
    }
    if (attempts.at(-1)?.error) return { ...attempts.at(-1), attempts, snapshots: [] }
    const setControl = async (label: string, value: string, operationId: string) => {
      observation = await actions.inputPublished('rain-range-run', { operationId,
        handle: observation.elements.find(element => element.tag === 'input' && element.label === label)!.handle, value })
    }
    await setControl('硬化比例百分比', '40', 'hardening-40')
    const snapshots = []
    for (const [index, value] of ['30', '20', '30'].entries()) {
      await setControl('土壤入渗能力I毫米', value, 'infiltration-' + index)
      const png = (await actions.readResource('rain-range-run', observation.image.resourceId)).bytes
      const screenshot = path.join(directory, `snapshot-I${value}-${index}.png`)
      await fs.writeFile(screenshot, png)
      const image = nativeImage.createFromBuffer(Buffer.from(png))
      const bar = observation.elements.find(element => element.label === 'Water balance paint')!
      const size = image.getSize(), scale = size.width / observation.observationScope!.viewport!.width
      // At P40/f40 the green share moves between 30% (I20) and 45% (I30).
      // This pixel is inside the changed region, well away from both edges.
      const pixel = (Math.floor((bar.rect.y + bar.rect.height / 2) * scale) * size.width
        + Math.floor((bar.rect.x + bar.rect.width * .375) * scale)) * 4
      const color = [...image.toBitmap().subarray(pixel, pixel + 4)]
      snapshots.push({ requested: value, actual: observation.elements.find(element => element.tag === 'input' && element.label === '土壤入渗能力I毫米')!.value,
        inputs: observation.elements.filter(element => element.tag === 'input').map(element => ({ label: element.label, value: element.value })),
        values: observation.elements.filter(element => element.tag === 'strong').map(element => element.text), color,
        formula: observation.elements.find(element => element.tag === 'p' && element.text.includes(' × min('))?.text,
        generation: observation.generation, resourceId: observation.image.resourceId, screenshot })
    }
    return { ...attempts.at(-1), attempts, snapshots }
  } finally { actions.stopRun('rain-range-run'); published.dispose() }
})
