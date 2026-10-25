// @vitest-environment node
import { build, transform } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { TEXT_DEFINITION, createTextData } from '../../src/components/text'
import type { DocumentEvent } from '../../src/shared/workbench/document'
import { setRootContainers } from '../helpers/glxWorkFixture'
import { deferred } from '../helpers/courseV10StoreHost'

const json = (value: unknown) => JSON.parse(JSON.stringify(value))
const frame = (x: number, y: number, width = 200, height = 80) => ({ width, height, transform: [1, 0, 0, 1, x, y] as [number, number, number, number, number, number] })
const source = `export default { mount(ctx) {
  const field = document.createElement('div');
  field.dataset.selectionLabel = 'true';
  Object.assign(field.style, {position:'absolute',left:'20px',top:'15px',width:'200px',height:'40px',background:'#e4f3e8',fontSize:'24px'});
  field.textContent = ctx.instance.data.label;
  const body = document.createElement('div');
  body.dataset.selectionBackground = 'true';
  Object.assign(body.style,{position:'absolute',left:'0',top:'80px',width:'300px',height:'100px',background:'#609e88'});
  ctx.root.append(field,body);
  const off = ctx.authoring.register({kind:'text',authorKey:'label',dataPath:['label'],initialValue:ctx.instance.data.label,
    localBounds:{width:200,height:40,transform:[1,0,0,1,20,15]}});
  return {update(instance) {field.textContent=instance.data.label}, dispose() {off();field.remove();body.remove()}};
} }`

it('keeps later Nodes selections across physical host paint and Source realm protocol ACKs, and drags only the painted background target', async () => {
  const directory = resolve('output/test-runs/format-core-repair/selection/browser')
  await mkdir(directory, { recursive: true })
  const project = createBlankCourseProjectV10('Selection ACK boundary'), surfaceId = project.rootIds[0]
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  project.definitions.source = { id: 'source', role: 'content', implementation: { kind: 'source', language: 'javascript', source } }
  project.instances.text = { id: 'text', definitionId: TEXT_DEFINITION.id, name: '原输入 A', data: json(createTextData('原输入')), frame: frame(70, 60) }
  project.instances.neighbor = { id: 'neighbor', definitionId: TEXT_DEFINITION.id, name: '新选择 B', data: json(createTextData('邻对象')), frame: frame(70, 250) }
  project.instances.source = { id: 'source', definitionId: 'source', name: 'Source 组件', data: { label: '内部文字' }, frame: frame(430, 90, 300, 180) }
  setRootContainers(project, [{ id: surfaceId, title: 'Slide', kind: 'slide', childIds: ['text', 'neighbor', 'source'], designSize: { width: 960, height: 640 } }])
  const host = new DocumentHostService(join(directory, `recovery-${Date.now()}`))
  const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'selection.glx')
  const events: DocumentEvent[] = [], off = host.subscribeEvents(event => events.push(event)), errors: string[] = []
  let ack: ReturnType<typeof deferred> | undefined, waiting = false
  const bundle = await build({ stdin: { contents: 'import "./src/renderer/styles/variables.css";import "./src/renderer/styles/globals.css";export * from "./tests/helpers/currentSlideSelectionBrowserHarness"', resolveDir: process.cwd() },
    bundle: true, platform: 'browser', format: 'iife', globalName: 'SelectionBoundary', write: false, outfile: join(directory, 'editor.js'),
    loader: { '.css': 'css', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.png': 'dataurl' }, logLevel: 'silent' })
  const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.setDefaultTimeout(7000); page.on('pageerror', error => errors.push(error.message))
  const selected = () => page.evaluate(() => (window as any).SelectionBoundary.useEditorStore.getState().courseView.selectedInstanceIds)
  try {
    await page.route('http://localhost/selection-boundary', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>html,body{margin:0;width:100%;height:100%}#editor{position:absolute;inset:0 240px 0 0}#nodes{position:absolute;right:0;top:0;width:240px;height:100%;overflow:auto}</style><main id="editor"></main><aside id="nodes"></aside>' }))
    await page.goto('http://localhost/selection-boundary')
    await page.exposeFunction('selectionCompile', async (input: any) => {
      // This import-free JavaScript fixture uses the same compilation contract;
      // esbuild transforms its actual Source before the real sandbox mounts it.
      const compiled = await transform(input.files[input.entry], { loader: 'js', format: 'esm' })
      return { status: 'ready', artifact: { format: 'esm', code: compiled.code, css: '', diagnostics: [] }, source: input, cacheHit: false, durationMs: 0 }
    })
    await page.exposeFunction('selectionDocumentCall', async (name: string, args: unknown[]) => {
      if (name === 'dispatch' && ack) { waiting = true; await ack.promise }
      const result = name === 'bootstrapCourse' ? await host.internalAPI.read(initial.documentId)
        : name === 'readAuthoringDrafts' ? await host.readAuthoringDrafts(args[0] as string)
        : name === 'writeAuthoringDrafts' ? await host.writeAuthoringDrafts(args[0] as string, args[1] as any)
        : name === 'clearAuthoringDrafts' ? await host.clearAuthoringDrafts(args[0] as string)
        : await (host.internalAPI as any)[name](...args)
      return json({ result, events: events.splice(0) })
    })
    for (const file of bundle.outputFiles.filter(file => file.path.endsWith('.css'))) await page.addStyleTag({ content: file.text })
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text })
    await page.evaluate(async () => {
      ;(window as any).desktopAPI = { compileComponent: (input: any) => (window as any).selectionCompile(input) }
      const listeners = new Set<(event: any) => void>()
      const methods = ['list', 'read', 'dispatch', 'lookup', 'restore', 'save', 'bootstrapCourse', 'readAuthoringDrafts', 'writeAuthoringDrafts', 'clearAuthoringDrafts']
      const api = { ...Object.fromEntries(methods.map(name => [name, async (...args: any[]) => {
        const packet = await (window as any).selectionDocumentCall(name, args)
        packet.events.forEach((event: any) => listeners.forEach(listener => listener(event)))
        return packet.result
      }])), subscribe: (listener: (event: any) => void) => { listeners.add(listener); return () => listeners.delete(listener) } }
      ;(window as any).selectionHarness = await (window as any).SelectionBoundary.mountSlideSelectionBrowserHarness(document.getElementById('editor'), document.getElementById('nodes'), api)
      ;(window as any).realmFacts = []
      document.addEventListener('component-author-pointer', event => (window as any).realmFacts.push((event as CustomEvent).detail), true)
      ;(window as any).pointerFacts = []; (window as any).paintFacts = []
      const state = () => (window as any).SelectionBoundary.useEditorStore.getState()
      const record = (event: PointerEvent) => {
        const target = event.target as Element, workspace = document.querySelector('main.workspace')
        ;(window as any).pointerFacts.push({ type: event.type, id: event.pointerId, x: event.clientX, y: event.clientY, buttons: event.buttons,
          target: target.localName, classes: target.getAttribute('class'), handle: target.closest('[data-handle]')?.getAttribute('data-handle'),
          captured: (workspace as HTMLElement)?.hasPointerCapture(event.pointerId), ids: state().courseView.selectedInstanceIds,
          sourceTransform: (document.querySelector('[data-component-instance="source"]') as HTMLElement)?.style.transform })
      }
      for (const name of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture'])
        document.addEventListener(name, record as EventListener, true)
      document.addEventListener('component-author-hit-test', event => {
        const detail = (event as CustomEvent).detail, resolve = detail.resolve, id = (window as any).paintFacts.length
        ;(window as any).paintFacts.push({ type: 'request', id, point: detail.point, ids: state().courseView.selectedInstanceIds })
        detail.resolve = (result: any) => {
          ;(window as any).paintFacts.push({ type: 'reply', id, result, ids: state().courseView.selectedInstanceIds }); resolve(result)
        }
      }, true)
    })
    const iframe = page.frameLocator('[data-component-render="source"] iframe')
    const field = iframe.locator('[data-selection-label]'), background = iframe.locator('[data-selection-background]')
    await field.waitFor()
    const native = page.locator('[data-component-render="text"]'), nativeBox = await native.boundingBox()
    if (!nativeBox) throw new Error('Native text has no bounds')
    const textPoint = { x: nativeBox.x + 20, y: nativeBox.y + 20 }
    await page.mouse.click(textPoint.x, textPoint.y)
    expect(await selected()).toEqual(['text'])
    expect(await page.getByRole('textbox', { name: '正文编辑', exact: true }).count()).toBe(0)
    const observations: unknown[] = []
    for (const [index, mode] of (['physical-host', 'source-realm-protocol'] as const).entries()) {
      await page.mouse.dblclick(textPoint.x, textPoint.y)
      const input = page.getByRole('textbox', { name: '正文编辑', exact: true }), value = `A 等待 ACK 的正式输入 ${index}`
      ack = deferred(); waiting = false
      // Native ProseMirror may submit a keep-open input transaction during fill;
      // hold that real ACK before typing, rather than missing it after blur.
      await input.fill(value)
      if (mode === 'physical-host') {
        // The production authoring hit-plane receives an ordinary mouse click;
        // its paint query still reaches this actual rendered Source document.
        const box = await field.boundingBox()
        if (!box) throw new Error('Source field has no painted bounds')
        await page.mouse.click(box.x + 30, box.y + 20)
      } else {
        // Exercise the existing realm producer and sandbox transport without
        // hiding the host hit-plane. This is protocol integration, not a claim
        // that an ordinary physical mouse bypasses the production hit-plane.
        await field.evaluate(element => {
          const rect = element.getBoundingClientRect()
          for (const type of ['pointerdown', 'pointerup']) element.dispatchEvent(new PointerEvent(type, {
            bubbles: true, cancelable: true, pointerId: 41, button: 0, clientX: rect.x + 30, clientY: rect.y + 20,
          }))
        })
      }
      await expect.poll(() => waiting).toBe(true)
      const realm = await page.evaluate(() => (window as any).realmFacts)
      if (mode === 'physical-host') expect(realm).toEqual([])
      else expect(realm.some((fact: any) => fact.phase === 'start' && fact.authorKey === 'label')).toBe(true)
      await page.getByTestId('node-item-neighbor').locator('.node-name').click()
      await expect.poll(selected).toEqual(['neighbor'])
      const held = { ids: await selected(), edit: await page.evaluate(() => (window as any).SelectionBoundary.useEditorStore.getState().slideContentEdit?.instanceId) }
      ack.resolve(); ack = undefined
      await expect.poll(() => page.evaluate(() => (window as any).SelectionBoundary.useEditorStore.getState().slideContentEdit === null)).toBe(true)
      // Let the already-resolved continuation run. The formal ACK, rather than
      // an arbitrary duration, is the barrier for observing its selection.
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
      const afterAck = { ids: await selected(), edit: await page.evaluate(() => (window as any).SelectionBoundary.useEditorStore.getState().slideContentEdit?.instanceId ?? null) }
      observations.push({ mode, held, afterAck, realm })
      await writeFile(join(directory, 'ack-facts.json'), JSON.stringify(observations, null, 2))
      expect(afterAck).toEqual({ ids: ['neighbor'], edit: null })
      const committed = await host.internalAPI.read(initial.documentId)
      expect(committed.undoDepth).toBe(index + 1)
      expect(committed.model).toMatchObject({ project: { instances: { text: { data: json(createTextData(value)) },
        neighbor: project.instances.neighbor, source: project.instances.source } } })
    }

    // A physical pointer over the Source's painted non-field region must move
    // that instance alone, retaining the current native neighbour and History.
    const clickedBox = await background.boundingBox()
    if (!clickedBox) throw new Error('Source background has no painted bounds')
    // The selected neighbour's floating quick bar crosses the upper half of
    // this background. Use its actually visible lower region without hiding UI.
    await page.mouse.click(clickedBox.x + clickedBox.width / 3, clickedBox.y + clickedBox.height * .75)
    await expect.poll(selected).toEqual(['source'])
    expect(await selected()).toEqual(['source'])
    const box = await background.boundingBox()
    if (!box) throw new Error('Source background has no painted bounds')
    const scale = box.width / 300
    const from = { x: box.x + 100 * scale, y: box.y + 75 * scale }, to = { x: from.x + 40 * scale, y: from.y + 30 * scale }
    await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 4 }); await page.mouse.up()
    await expect.poll(async () => (await host.internalAPI.read(initial.documentId)).undoDepth).toBe(3)
    const moved = await host.internalAPI.read(initial.documentId)
    expect(moved.model).toMatchObject({ project: { instances: { source: { frame: { width: 300, height: 180 } }, neighbor: project.instances.neighbor } } })
    if (moved.model.kind !== 'course-v10') throw new Error('Expected course model')
    const movedTransform = moved.model.project.instances.source.frame!.transform
    expect(movedTransform.slice(0, 4)).toEqual([1, 0, 0, 1])
    expect(movedTransform[4]).toBeCloseTo(470, 6); expect(movedTransform[5]).toBeCloseTo(120, 6)
    expect(await page.getByRole('textbox', { name: '正文编辑', exact: true }).count()).toBe(0)
    await page.evaluate(async id => (window as any).SelectionBoundary.useEditorStore.getState().courseBridge.undo(id), initial.documentId)
    expect((await host.internalAPI.read(initial.documentId)).model).toMatchObject({ project: { instances: { source: project.instances.source, neighbor: project.instances.neighbor } } })
    expect(errors).toEqual([])
    expect(await page.evaluate(() => (window as any).selectionHarness.errors)).toEqual([])
    await page.screenshot({ path: join(directory, 'selection-after-undo.png') })
    await writeFile(join(directory, 'facts.json'), JSON.stringify({ browser: browser.version(), actualMainBridge: true, actualSourceRealm: true, actualNodesUI: true,
      physicalHostAckRetainsNewSelection: true, realmProtocolAckRetainsNewSelection: true, eachInputCommittedOnce: true,
      paintedSourceBackgroundDrag: true, neighborUntouched: true, oneDragHistory: true, undo: true, errors }, null, 2))
  } catch (error) {
    await page.screenshot({ path: join(directory, 'failure.png') }).catch(() => {})
    await writeFile(join(directory, 'failure.json'), JSON.stringify({ error: String(error), errors, main: await host.internalAPI.read(initial.documentId), body: await page.locator('body').innerText(),
      state: await page.evaluate(() => { const state = (window as any).SelectionBoundary?.useEditorStore.getState(); return { ids: state?.courseView.selectedInstanceIds,
        edit: state?.slideContentEdit?.instanceId, interaction: state?.courseView.interactionSelection, realm: (window as any).realmFacts,
        pointer: (window as any).pointerFacts, paint: (window as any).paintFacts, reports: (window as any).selectionHarness?.errors } }) }, null, 2))
    throw error
  } finally {
    ack?.resolve(); await page.evaluate(() => (window as any).selectionHarness?.dispose()).catch(() => {})
    await browser.close(); off()
  }
}, 30000)
