// @vitest-environment node
import { build } from 'esbuild'
import { chromium } from '@playwright/test'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { CourseProjectV11 } from '../../src/shared/contracts/component-platform/project'
import { buildPublishedCourseV4 } from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import { compileCoursePlayback } from '../../src/core/publish/componentPlatform/compileCoursePlayback'
import { buildCompiledSingleHtml } from '../../src/core/publish/componentPlatform/buildSingleHtml'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import { createTextComponentData } from '../../src/components/text/data'
import { plainDocumentText } from '../../src/shared/document/content'
import { createInputData } from '../../src/components/input/data'
import { jsonValueSchema } from '../../src/shared/contracts/component-platform/schema'

const blank = (): CourseProjectV11 => ({ schemaVersion: 11, id: 'delivery-work', revision: 2, title: '作品发布',
  definitions: {}, instances: {}, rootIds: [], global: { underlay: [], overlay: [] }, assets: {} })
const textData = (text: string) => jsonValueSchema.parse(JSON.parse(JSON.stringify(createTextComponentData(text))))
async function stage<T>(name: string, work: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([work, new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error(`${name} did not complete`)), 8_000) })]) }
  finally { clearTimeout(timeout) }
}

let bundle: Promise<string> | undefined
function playerBundle() {
  return bundle ??= build({ stdin: { contents: `export {mountCompiledCourse} from './src/player/componentPlatform/compiledPlayer';
    export {mountPublishedCourseV4} from './src/player/componentPlatform/publishedPlayer';
    export {prepareComponentOutputRegion} from './src/player/componentPlatform/outputCapture';`, resolveDir: process.cwd(), loader: 'ts' },
    platform: 'browser', target: 'es2022', bundle: true, write: false, format: 'iife', globalName: 'WorkDelivery' })
    .then(result => result.outputFiles[0]!.text)
}
async function published(project: CourseProjectV11) {
  return buildPublishedCourseV4({ project, assetBytes: {} }, { compilation: new InMemoryComponentCompilation(createEsbuildComponentCompiler()) })
}
async function compiled(project: CourseProjectV11) {
  const result = await published(project), dom = new JSDOM('<!doctype html>')
  try { return await compileCoursePlayback(result.payload, { document: dom.window.document,
    renderBuiltin: async instance => { const data = instance.data as { text?: string; content?: Parameters<typeof plainDocumentText>[0] }; return `<p>${data.text ?? (data.content ? plainDocumentText(data.content) : '')}</p>` } }) }
  finally { dom.window.close() }
}
async function browserFixture() {
  const browser = await stage('launch browser', chromium.launch({ headless: true })), page = await stage('new page', browser.newPage({ viewport: { width: 1000, height: 700 } }))
  page.setDefaultTimeout(5_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setContent('<!doctype html><style>html,body,#root{width:100%;height:100%;margin:0}</style><main id="root"></main>')
  await page.addScriptTag({ content: await stage('bundle player', playerBundle()) })
  return { browser, page, errors }
}

function nestedWork() {
  const project = blank()
  project.definitions.flow = { id: 'flow', role: 'mixed', implementation: { kind: 'builtin', key: 'guoling.container.flow' } }
  project.definitions.spatial = { id: 'spatial', role: 'mixed', implementation: { kind: 'builtin', key: 'guoling.container.spatial' } }
  project.definitions.slide = { id: 'slide', role: 'mixed', implementation: { kind: 'builtin', key: 'guoling.container.slide' } }
  project.definitions.text = { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } }
  project.definitions.button = { id: 'button', role: 'mixed', implementation: { kind: 'source', language: 'javascript', source: `export default { mount(context) {
    const button=document.createElement('button');button.textContent=context.instance.data.containerId+' details';
    button.onclick=async()=>{const ok=await context.teacherController.execute({type:'scene.go',containerId:context.instance.data.containerId,sceneId:context.instance.data.containerId,targetStateId:'detail'});button.dataset.applied=String(ok)};
    context.root.append(button);return { update(){},dispose(){button.remove()} };
  } }` } }
  project.instances.flow = { id: 'flow', definitionId: 'flow', data: {}, childIds: ['left', 'right'], container: { kind: 'flow', flow: { layout: { readingWidth: 860, wideContentWidth: 1100, toc: 'hidden' } } } }
  for (const side of ['left', 'right']) {
    project.instances[side] = { id: side, definitionId: 'slide', data: {}, childIds: [`${side}-title`, `${side}-button`, `${side}-camera`],
      frame: { width: 700, height: 240, transform: [1, 0, 0, 1, 0, 0] }, container: { kind: 'slide', designSize: { width: 700, height: 240 }, background: { mode: 'own', color: side === 'left' ? '#e0f2fe' : '#fef3c7' },
        presentation: { states: [{ id: 'detail', title: '详情', background: { mode: 'own', color: '#dcfce7' }, overrides: { [`${side}-title`]: { data: { text: `${side} detail` } } } }] } } }
    project.instances[`${side}-title`] = { id: `${side}-title`, definitionId: 'text', data: { text: `${side} overview` }, frame: { width: 220, height: 60, transform: [1, 0, 0, 1, 20, 20] } }
    project.instances[`${side}-button`] = { id: `${side}-button`, definitionId: 'button', data: { containerId: side }, frame: { width: 220, height: 60, transform: [1, 0, 0, 1, 20, 100] } }
    project.instances[`${side}-camera`] = { id: `${side}-camera`, definitionId: 'spatial', data: {}, childIds: [],
      frame: { width: 80, height: 40, transform: [1, 0, 0, 1, 600, 0] }, container: { kind: 'spatial', spatial: { home: { x: 350, y: 120, zoom: 1 }, frames: [] } } }
  }
  project.rootIds = ['flow']; project.entry = { rootInstanceId: 'flow' }
  return project
}

describe('actual work delivery consumers', () => {
  it('runs a pure source application in its real viewport with input and its own animation loop', async () => {
    const project = blank()
    project.definitions.app = { id: 'app', role: 'mixed', implementation: { kind: 'source', language: 'javascript', source: `export default { mount({root,instance,scope}) {
      const input=document.createElement('input'),button=document.createElement('button'),canvas=document.createElement('canvas');
      input.value='first';button.textContent=instance.data.label;canvas.width=120;canvas.height=40;
      button.onclick=()=>{button.textContent=input.value};root.append(input,button,canvas);
      let ticks=0,frame;const paint=()=>{canvas.dataset.ticks=String(++ticks);canvas.getContext('2d').fillRect(ticks%120,0,1,40);frame=requestAnimationFrame(paint)};paint();
      scope.cleanup(()=>cancelAnimationFrame(frame));return{update(next){button.textContent=next.data.label},dispose(){root.replaceChildren()}};
    } }` } }
    project.instances.app = { id: 'app', definitionId: 'app', data: { label: 'saved label' } }
    project.rootIds = ['app']; project.entry = { rootInstanceId: 'app' }
    const artifact = await stage('compile pure program', compiled(project)), f = await browserFixture()
    const directory = await mkdtemp(join(tmpdir(), 'glx-work-html-')), file = join(directory, 'source-app.html')
    try {
      await writeFile(file, buildCompiledSingleHtml(artifact, `${await playerBundle()};var CoursewareCompiledPlayer=WorkDelivery;`), 'utf8')
      await stage('open exported source HTML', f.page.goto(pathToFileURL(file).href))
      await stage('boot exported source HTML', f.page.evaluate(async () => { (window as any).workPlayer = await (window as any).coursePlayerReady }))
      expect(await f.page.locator('#course-diagnostic').isHidden()).toBe(true)
      const content = await f.page.locator('[data-compiled-node="app"] iframe').count()
        ? f.page.frameLocator('[data-compiled-node="app"] iframe') : f.page
      await content.getByRole('textbox').fill('changed input')
      await content.getByRole('button', { name: 'saved label' }).click()
      await expect.poll(() => content.getByRole('button').textContent()).toBe('changed input')
      await expect.poll(() => content.locator('canvas').getAttribute('data-ticks')).not.toBe('1')
      const geometry = await f.page.locator('[data-compiled-program-viewport]').boundingBox()
      expect(geometry).toMatchObject({ x: 0, y: 0, width: 1000, height: 700 })
      expect(await f.page.locator('[data-compiled-surface]').count()).toBe(0)
      expect(artifact.course).not.toHaveProperty('surfaces')
      expect(f.errors).toEqual([])
      await f.page.evaluate(() => (window as any).workPlayer.dispose())
      expect(await f.page.locator('#course-root').count()).toBe(1)
    } finally { await f.browser.close(); await unlink(file).catch(() => {}); await rmdir(directory) }
  }, 30_000)

  it('keeps two nested container states and cameras independent in the compiled interactive output', async () => {
    const artifact = await stage('compile nested containers', compiled(nestedWork())), f = await browserFixture()
    try {
      await stage('mount nested containers', f.page.evaluate(async serialized => { const value = JSON.parse(serialized); (window as any).reports=[];(window as any).workPlayer = await (window as any).WorkDelivery.mountCompiledCourse(value, document.getElementById('root'),{report:(message:string)=>(window as any).reports.push(message)}) }, JSON.stringify(artifact)))
      expect(await f.page.evaluate(() => (window as any).reports)).toEqual([])
      const leftContent = await f.page.locator('[data-compiled-node="left-button"] iframe').count()
        ? f.page.frameLocator('[data-compiled-node="left-button"] iframe') : f.page
      await leftContent.getByRole('button', { name: 'left details' }).click()
      await expect.poll(() => f.page.locator('[data-compiled-node="left-title"]').textContent()).toBe('left detail')
      expect(await f.page.locator('[data-compiled-node="right-title"]').textContent()).toBe('right overview')
      const actual = await f.page.evaluate(async () => {
        const player = (window as any).workPlayer
        await player.navigation.execute({ type: 'camera.present', containerId: 'left-camera', pose: { x: 300, y: 120, zoom: 1.2 } })
        return { left: player.camera('left-camera').read(), right: player.camera('right-camera').read(),
          mounted: [...document.querySelectorAll('[data-compiled-runtime-root]')].map(node => (node as HTMLElement).dataset.compiledRuntimeRoot) }
      })
      expect(actual.left.zoom).toBe(1.2); expect(actual.right.zoom).toBe(1)
      expect(new Set(actual.mounted).size).toBe(actual.mounted.length)
      expect(f.errors).toEqual([])
      await f.page.evaluate(() => (window as any).workPlayer.dispose())
    } finally { await f.browser.close() }
  }, 30_000)

  it('captures a real nested container viewport with its native descendants visible', async () => {
    const project = nestedWork()
    for (const side of ['left', 'right']) {
      project.instances[side]!.childIds = [`${side}-title`]
      project.instances[`${side}-title`]!.data = textData(`${side} native content`)
      delete project.instances[`${side}-button`]
      delete project.instances[`${side}-camera`]
      delete project.instances[side]!.container!.presentation
    }
    project.instances.left!.style = { opacity: 0.5 }
    const result = await stage('publish capture work', published(project)), f = await browserFixture()
    try {
      const actual = await stage('prepare actual container capture', f.page.evaluate(async serialized => {
        const payload = JSON.parse(serialized)
        const root = document.getElementById('root')!, reports: string[] = []
        const player = await (window as any).WorkDelivery.mountPublishedCourseV4(payload, root, { capture: true, keyboardNavigation: false, report: (message: string) => reports.push(message) })
        ;(window as any).workPlayer = player
        const rect = await (window as any).WorkDelivery.prepareComponentOutputRegion({ payload, root, player, surfaceId: 'flow', instanceId: 'left', staticExport: true })
        const container = player.runtime.targetElement('left') as HTMLElement, child = player.runtime.targetElement('left-title') as HTMLElement
        const childRect = child.getBoundingClientRect()
        return { rect, childInside: container.contains(child), hidden: child.hidden, visible: childRect.width > 0 && childRect.height > 0,
          text: child.textContent, capturedOpacity: getComputedStyle(root.querySelector('[data-component-local-capture]')!.firstElementChild!).opacity,
          bodyStyle: document.body.getAttribute('style'), reports }
      }, JSON.stringify(result.payload)))
      expect(actual.rect.width).toBe(700); expect(actual.rect.height).toBe(240)
      expect(actual.childInside).toBe(true); expect(actual.hidden).toBe(false); expect(actual.visible).toBe(true)
      expect(actual.text).toContain('left native content'); expect(actual.bodyStyle).toBeNull(); expect(actual.reports).toEqual([])
      expect(actual.capturedOpacity).toBe('0.5')
      expect(f.errors).toEqual([])
      await f.page.screenshot({ clip: actual.rect })
      await f.page.evaluate(() => (window as any).workPlayer.dispose())
    } finally { await f.browser.close() }
  }, 30_000)

  it('keeps a source entry as the active root and applies explicit local state through both delivery players', async () => {
    const project = nestedWork()
    project.instances.app = { id: 'app', definitionId: 'button', data: { containerId: 'left' }, childIds: ['left', 'right'] }
    project.rootIds = ['app']; project.entry = { rootInstanceId: 'app' }; delete project.instances.flow
    for (const [index, side] of ['left', 'right'].entries()) {
      project.instances[side]!.frame!.transform = [1, 0, 0, 1, 0, 100 + 260 * index]
      project.instances[side]!.childIds = [`${side}-title`]
      project.instances[`${side}-title`]!.data = textData(`${side} overview`)
      project.instances[side]!.container!.presentation!.states[0]!.overrides![`${side}-title`]!.data = textData(`${side} detail`)
      delete project.instances[`${side}-button`]
      delete project.instances[`${side}-camera`]
    }
    // A separate presentation root must not replace the program's explicit entry.
    project.instances.other = { id: 'other', definitionId: 'spatial', data: {}, childIds: [], container: { kind: 'spatial', designSize: { width: 400, height: 300 }, spatial: { home: { x: 200, y: 150, zoom: 1 }, frames: [] } } }
    project.rootIds.push('other')
    const payload = (await stage('publish mixed source root', published(project))).payload, artifact = await stage('compile mixed source root', compiled(project))
    for (const mode of ['published', 'compiled'] as const) {
      const f = await browserFixture()
      try {
        await stage(`mount ${mode} source root`, f.page.evaluate(async serialized => {
          const { value, mode } = JSON.parse(serialized)
          ;(window as any).reports = []
          const api = (window as any).WorkDelivery, mount = mode === 'published' ? api.mountPublishedCourseV4 : api.mountCompiledCourse
          ;(window as any).workPlayer = await mount(value, document.getElementById('root'), { keyboardNavigation: false, report: (message: string) => (window as any).reports.push(message) })
        }, JSON.stringify({ value: mode === 'published' ? payload : artifact, mode })))
        const state = await f.page.evaluate(() => { const p = (window as any).workPlayer, source = p.navigation.forInstance('app'); return { location: source.read().locationId, leftActive: p.navigation.isContainerActive('left'), implicitNext: source.canExecute({ type: 'step.next' }) } })
        expect(state).toEqual({ location: null, leftActive: true, implicitNext: false })
        const content = f.page.frameLocator(mode === 'published' ? '[data-component-instance-id="app"] iframe' : '[data-compiled-node="app"] iframe')
        await content.getByRole('button', { name: 'left details' }).click()
        await expect.poll(() => f.page.evaluate(() => (window as any).workPlayer.runtime.targetElement('left-title').textContent)).toContain('left detail')
        expect(await f.page.evaluate(() => (window as any).workPlayer.runtime.targetElement('right-title').textContent)).toContain('right overview')
        const paint = await f.page.evaluate(() => Object.fromEntries(['left', 'right'].map(id => { const layer = (window as any).workPlayer.runtime.targetElement(id).querySelector(':scope > [data-component-background-paint] > div'); return [id, layer ? getComputedStyle(layer).backgroundColor : null] })))
        expect(paint).toEqual({ left: 'rgb(220, 252, 231)', right: 'rgb(254, 243, 199)' })
        const returned = await f.page.evaluate(async () => { const player = (window as any).workPlayer; const other = await player.go('other'); const source = await player.go('app'); return { other, source, location: player.navigation.read().locationId, leftActive: player.navigation.isContainerActive('left') } })
        expect(returned).toEqual({ other: true, source: true, location: 'app', leftActive: true })
        expect(await f.page.evaluate(() => (window as any).reports)).toEqual([]); expect(f.errors).toEqual([])
        await f.page.evaluate(() => (window as any).workPlayer.dispose())
      } finally { await f.browser.close() }
    }
  }, 30_000)

  it('retains an allocated Flow viewport for unframed and empty nested containers', async () => {
    const project = nestedWork()
    for (const side of ['left', 'right']) {
      delete project.instances[side]!.frame
      project.instances[side]!.childIds = []
      delete project.instances[`${side}-title`]; delete project.instances[`${side}-button`]
      delete project.instances[`${side}-camera`]
      delete project.instances[side]!.container!.presentation
    }
    delete project.instances.right!.container!.designSize
    const payload = (await stage('publish unframed containers', published(project))).payload, artifact = await stage('compile unframed containers', compiled(project))
    for (const mode of ['published', 'compiled'] as const) {
      const f = await browserFixture()
      try {
        const geometry = await stage(`mount ${mode} unframed containers`, f.page.evaluate(async serialized => {
          const { value, mode } = JSON.parse(serialized)
          const api = (window as any).WorkDelivery, mount = mode === 'published' ? api.mountPublishedCourseV4 : api.mountCompiledCourse
          const player = await mount(value, document.getElementById('root'), { keyboardNavigation: false })
          ;(window as any).workPlayer = player
          return Object.fromEntries(['left', 'right'].map(id => { const element = player.runtime.targetElement(id); return [id, { height: element.offsetHeight, visibleHeight: element.getBoundingClientRect().height }] }))
        }, JSON.stringify({ value: mode === 'published' ? payload : artifact, mode })))
        expect(geometry.left.height).toBe(240); expect(geometry.right.height).toBe(320)
        expect(geometry.left.visibleHeight).toBeGreaterThan(0); expect(geometry.right.visibleHeight).toBeGreaterThan(0)
        expect(f.errors).toEqual([])
        await f.page.evaluate(() => (window as any).workPlayer.dispose())
      } finally { await f.browser.close() }
    }
  }, 30_000)

  it('runs a real container Source layout with an interactive native child slot in both delivery players', async () => {
    const project = blank()
    project.definitions.text = { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } }
    project.definitions.input = { id: 'input', role: 'mixed', implementation: { kind: 'builtin', key: 'guoling.input' } }
    project.definitions.container = { id: 'container', role: 'mixed', implementation: { kind: 'source', language: 'javascript', source: `export default { mount(context) {
      context.scope.state.set('container-mounts',(context.scope.state.get('container-mounts')||0)+1);
      const button=document.createElement('button'),move=document.createElement('button'),rebind=document.createElement('button'),releaseOld=document.createElement('button'),releaseCurrent=document.createElement('button'),slot=document.createElement('div'),next=document.createElement('div'),caption=document.createElement('div');
      button.textContent='Container action';move.textContent='Move slot';rebind.textContent='Rebind slot';releaseOld.textContent='Release old';releaseCurrent.textContent='Release current';slot.dataset.nativeChild='';next.dataset.nextChild='';
      for(const [index,control]of [button,move,rebind,releaseOld,releaseCurrent].entries())Object.assign(control.style,{position:'absolute',left:'8px',top:(8+index*44)+'px',width:'180px',height:'36px'});
      Object.assign(slot.style,{position:'absolute',left:'200px',top:'100px',width:'500px',height:'120px'});Object.assign(next.style,{position:'absolute',left:'400px',top:'350px',width:'450px',height:'120px'});Object.assign(caption.style,{position:'absolute',left:'200px',top:'240px',width:'500px',height:'80px'});
      context.root.append(button,move,rebind,releaseOld,releaseCurrent,slot,next,caption);
      const old=context.inline.mount('native',slot);let current=old;context.inline.mount('caption',caption);
      button.onclick=()=>{button.textContent='Container clicked'};move.onclick=()=>{slot.style.left='350px';slot.style.width='430px';caption.style.width='430px'};
      rebind.onclick=()=>{current=context.inline.mount('native',next)};releaseOld.onclick=()=>old();releaseCurrent.onclick=()=>current();
      return {update(){},dispose(){context.root.replaceChildren()}};
    } }` } }
    project.instances.container = { id: 'container', definitionId: 'container', data: {}, childIds: ['native', 'caption', 'untouched'], container: { kind: 'slide', designSize: { width: 1000, height: 700 } } }
    project.instances.native = { id: 'native', definitionId: 'input', data: createInputData({ label: 'Loaned native', submitLabel: 'Loaned submit', acceptedAnswers: ['ok'], stateKey: 'loaned-result' }), frame: { width: 500, height: 90, transform: [1, 0, 0, 1, 200, 500] } }
    project.instances.caption = { id: 'caption', definitionId: 'text', data: textData('one native child'), frame: { width: 300, height: 90, transform: [1, 0, 0, 1, 300, 100] } }
    project.instances.untouched = { id: 'untouched', definitionId: 'input', data: createInputData({ label: 'Default native', submitLabel: 'Default submit', stateKey: 'default-result' }), frame: { width: 700, height: 90, transform: [1, 0, 0, 1, 200, 600] } }
    project.rootIds = ['container']; project.entry = { rootInstanceId: 'container' }
    const payload = (await stage('publish Source container', published(project))).payload, artifact = await stage('compile Source container', compiled(project))
    for (const mode of ['published', 'compiled'] as const) {
      const f = await browserFixture()
      try {
        await stage(`mount ${mode} Source container`, f.page.evaluate(async serialized => {
          const { value, mode } = JSON.parse(serialized)
          ;(window as any).reports=[]
          const api = (window as any).WorkDelivery, mount = mode === 'published' ? api.mountPublishedCourseV4 : api.mountCompiledCourse
          ;(window as any).workPlayer = await mount(value, document.getElementById('root'), { keyboardNavigation: false, report: (message: string) => (window as any).reports.push(message) })
        }, JSON.stringify({ value: mode === 'published' ? payload : artifact, mode })))
        expect(await f.page.evaluate(() => (window as any).reports)).toEqual([])
        const frameSelector = mode === 'published' ? '[data-component-container-runtime="container"] iframe' : '[data-compiled-runtime-root="container"] iframe'
        const content = await f.page.locator(frameSelector).count() ? f.page.frameLocator(frameSelector) : f.page
        await content.getByRole('button', { name: 'Container action' }).click()
        expect(await content.getByRole('button', { name: 'Container clicked' }).textContent()).toBe('Container clicked')
        await f.page.getByRole('textbox', { name: 'Loaned native' }).fill('ok')
        await f.page.getByRole('button', { name: 'Loaned submit' }).click()
        await expect.poll(() => f.page.evaluate(() => (window as any).workPlayer.runtime.getState('loaned-result')?.correct)).toBe(true)
        await f.page.getByRole('textbox', { name: 'Default native' }).fill('untouched')
        try { await f.page.getByRole('button', { name: 'Default submit' }).click() }
        catch (error) {
          const facts = await f.page.evaluate(() => {
            const runtime = (window as any).workPlayer.runtime
            const bounds = (node: HTMLElement) => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }
            return Object.fromEntries(['native', 'caption', 'untouched'].map(id => { const target = runtime.targetElement(id); return [id, { box: bounds(target), style: target.getAttribute('style'), children: [...target.querySelectorAll('[data-text-component],form')].map(node => ({ box: bounds(node as HTMLElement), style: (node as HTMLElement).getAttribute('style') })) }] }))
          })
          throw new Error(`${mode} default native click: ${JSON.stringify(facts)}; ${String(error)}`)
        }
        await expect.poll(() => f.page.evaluate(() => (window as any).workPlayer.runtime.getState('default-result')?.value)).toBe('untouched')
        const nativeBox = () => f.page.evaluate(() => { const rect = (window as any).workPlayer.runtime.targetElement('native').getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height } })
        const captionBounds = () => f.page.evaluate(() => (window as any).workPlayer.runtime.authorSpots().find((spot: any) => spot.instanceId === 'caption')?.localBounds)
        const matchesSlot = async (selector: string) => { const expected = await content.locator(selector).boundingBox(), actual = await nativeBox(); return Boolean(expected && Math.abs(expected.x-actual.x)<1 && Math.abs(expected.y-actual.y)<1 && Math.abs(expected.width-actual.width)<1 && Math.abs(expected.height-actual.height)<1) }
        await expect.poll(() => matchesSlot('[data-native-child]')).toBe(true)
        if (mode === 'published') await expect.poll(captionBounds).toMatchObject({ width: 500, height: 80 })
        await content.getByRole('button', { name: 'Move slot' }).click()
        await expect.poll(() => matchesSlot('[data-native-child]')).toBe(true)
        if (mode === 'published') await expect.poll(captionBounds).toMatchObject({ width: 430, height: 80 })
        await content.getByRole('button', { name: 'Rebind slot' }).click()
        await expect.poll(() => matchesSlot('[data-next-child]')).toBe(true)
        await content.getByRole('button', { name: 'Release old', exact: true }).click()
        await expect.poll(() => matchesSlot('[data-next-child]')).toBe(true)
        expect(await f.page.evaluate(() => (window as any).workPlayer.runtime.targetElement('caption').textContent)).toContain('one native child')
        await content.getByRole('button', { name: 'Release current' }).click()
        await expect.poll(async () => Math.round((await nativeBox()).y)).toBe(500)
        expect(await f.page.getByRole('textbox', { name: 'Loaned native' }).inputValue()).toBe('ok')
        expect(await f.page.evaluate(() => (window as any).workPlayer.runtime.getState('container-mounts'))).toBe(1)
        expect(f.errors).toEqual([])
        await f.page.evaluate(() => (window as any).workPlayer.dispose())
      } finally { await f.browser.close() }
    }
  }, 30_000)
})
