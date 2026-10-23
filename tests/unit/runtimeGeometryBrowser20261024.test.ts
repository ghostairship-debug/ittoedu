// @vitest-environment node
import { expect, it } from 'vitest'
import { build } from 'esbuild'
import { chromium } from '@playwright/test'
import { JSDOM } from 'jsdom'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { compileCoursePlayback } from '../../src/core/publish/componentPlatform/compileCoursePlayback'
import type { PublishedCourseV4 } from '../../src/shared/contracts/component-platform/published'

const reader = `export default {mount(c){
 const button=c.root.ownerDocument.createElement('button'),output=c.root.ownerDocument.createElement('output');
 button.textContent='Measure'; c.root.append(button,output);
 button.onclick=async()=>{output.textContent=JSON.stringify(await c.scope.measure([{kind:'instance',instanceId:'first'},{kind:'instance',instanceId:'second'}]))};
 return{update(){},dispose(){button.onclick=null}}
}}`

it('measures compiled Flow and isolated iframe consumers against real browser scroll, resize and remount facts', async () => {
  const payload: PublishedCourseV4 = { schemaVersion: 4, id: 'runtime-geometry', title: 'Runtime geometry', rootIds: ['flow'], entry: { rootInstanceId: 'flow' }, assets: {}, global: { underlay: [], overlay: [] },
    definitions: { flow: { id: 'flow', role: 'content', implementation: { kind: 'builtin', key: 'guoling.container.flow' } },
      text: { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } },
      reader: { id: 'reader', role: 'content', implementation: { kind: 'source', language: 'javascript', source: reader, compiled: { code: reader, css: '' } } } },
    instances: { flow: { id: 'flow', definitionId: 'flow', data: {}, childIds: ['reader', 'first', 'spacer', 'second'], container: { kind: 'flow', flow: { layout: { widthMode: 'reading', readingWidth: 800, wideContentWidth: 800, toc: 'hidden' } } } },
      first: { id: 'first', definitionId: 'text', data: { height: 120 } }, spacer: { id: 'spacer', definitionId: 'text', data: { height: 1600 } },
      second: { id: 'second', definitionId: 'text', data: { height: 120 } }, reader: { id: 'reader', definitionId: 'reader', data: {}, frame: { width: 300, height: 100, transform: [1, 0, 0, 1, 0, 0] } } } }
  const dom = new JSDOM('<!doctype html>')
  const artifact = await compileCoursePlayback(payload, { document: dom.window.document,
    renderBuiltin: async instance => `<p style="margin:0;height:${(instance.data as { height: number }).height}px">${instance.id}</p>` })
  dom.window.close()
  expect(artifact.sourceFactories['definition:reader']).toBeTruthy()
  const bundled = await build({ stdin: { contents: "export {mountCompiledCourse} from './src/player/componentPlatform/compiledPlayer';export {ComponentRuntimeWorld} from './src/player/components/ComponentRuntimeWorld';export {preparePublishedNativeComponent} from './src/player/components/runtime/SandboxComponentRuntime'", resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, format: 'iife', globalName: 'GeometryProbe', platform: 'browser', target: 'es2022' })
  const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1100, height: 700 } }), errors: string[] = []
  const evidence: Record<string, unknown> = {}, output = resolve('output/resource-runtime-repair-20261024/geometry')
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.setContent('<!doctype html><style>html,body,#root{width:100%;height:100%;margin:0}</style><main id="root"></main>')
    await page.addScriptTag({ content: bundled.outputFiles[0].text })
    await page.evaluate(async serialized => { (window as any).geometryPlayer = await (window as any).GeometryProbe.mountCompiledCourse(JSON.parse(serialized), document.getElementById('root')) }, JSON.stringify(artifact))
    const sampleCompiled = () => page.evaluate(async () => {
      const node = document.querySelector<HTMLElement>('[data-compiled-node="reader"]')!, shadow = node.querySelector('[data-compiled-content]')?.shadowRoot
        ?? [...node.querySelectorAll('*')].map(element => element.shadowRoot).find(Boolean)
      const button = shadow?.querySelector('button') ?? node.querySelector('button'), output = shadow?.querySelector('output') ?? node.querySelector('output')
      if (!button || !output) throw new Error('Compiled reader was not mounted')
      output.textContent = ''; (button as HTMLElement).click()
      for (let i = 0; i < 100 && !output.textContent; i++) await new Promise(resolve => setTimeout(resolve, 5))
      return JSON.parse(output.textContent!)
    })
    const compiledBefore = await sampleCompiled()
    expect(compiledBefore.targets[1].viewportFrame.transform[5]).toBeGreaterThan(700)
    expect(compiledBefore.targets.map((target: any) => target.flow?.containerId)).toEqual(['flow', 'flow'])
    await page.evaluate(() => { document.querySelector<HTMLElement>('[data-flow-paper-scroll]')!.scrollTop = 400 })
    const compiledAfter = await sampleCompiled()
    expect(compiledAfter.targets.map((target: any) => target.flow.contentFrame)).toEqual(compiledBefore.targets.map((target: any) => target.flow.contentFrame))
    expect(compiledAfter.targets[0].flow.viewport.y).toBeCloseTo(400, 1)
    await page.setViewportSize({ width: 390, height: 700 })
    await expect.poll(async () => (await sampleCompiled()).targets[0].flow.viewport.width).toBeLessThan(compiledBefore.targets[0].flow.viewport.width)
    const compiledNarrow = await sampleCompiled()
    expect(compiledNarrow.targets[0].flow.viewport.width).toBeLessThan(compiledBefore.targets[0].flow.viewport.width)
    evidence.compiled = { before: compiledBefore, after: compiledAfter, narrow: compiledNarrow }
    await page.evaluate(() => (window as any).geometryPlayer.dispose())

    await page.setViewportSize({ width: 1100, height: 700 })
    await page.evaluate(async code => {
      const root = document.getElementById('root')!; root.innerHTML = '<section id="flow" style="width:800px;height:500px;position:relative"><div data-flow-paper-scroll style="width:800px;height:500px;overflow:auto;position:relative"><div id="first" style="height:120px"></div><div style="height:1600px"></div><div id="second" style="height:120px"></div></div></section><div id="reader" style="position:absolute;left:30px;top:10px;width:300px;height:100px;transform:scale(.75);transform-origin:0 0"></div>'
      const project: any = { schemaVersion: 11, id: 'iframe-geometry', title: 'Iframe', revision: 0, rootIds: ['flow'], entry: { rootInstanceId: 'flow' }, assets: {}, global: { underlay: [], overlay: [] },
        definitions: { flow: { id: 'flow', role: 'content', implementation: { kind: 'builtin', key: 'guoling.container.flow' } },
          text: { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' } }, reader: { id: 'reader', role: 'content', implementation: { kind: 'source', language: 'javascript', source: code } } },
        instances: { flow: { id: 'flow', definitionId: 'flow', data: {}, childIds: ['first', 'second', 'reader'], container: { kind: 'flow' } }, first: { id: 'first', definitionId: 'text', data: {} }, second: { id: 'second', definitionId: 'text', data: {} },
          reader: { id: 'reader', definitionId: 'reader', data: {}, frame: { width: 300, height: 100, transform: [1, 0, 0, 1, 0, 0] } } } }
      const world = new (window as any).GeometryProbe.ComponentRuntimeWorld('iframe-geometry', { mode: 'edit', resolveSource: async (implementation: any, signal: AbortSignal) =>
        (window as any).GeometryProbe.preparePublishedNativeComponent({ format: 'esm', code: implementation.source, css: '', diagnostics: [] }, signal, { state: () => ({}), targets: () => [] }) })
      world.bindTarget('flow', document.getElementById('flow')); world.bindTarget('first', document.getElementById('first')); world.bindTarget('second', document.getElementById('second')); world.bind('reader', document.getElementById('reader'))
      await world.sync(project, { assets: {}, components: {} }); (window as any).geometryWorld = world; (window as any).geometryProject = project
    }, reader)
    const frame = page.frameLocator('#reader iframe')
    const sampleIframe = async () => {
      const output = frame.locator('output'); await output.evaluate(element => { element.textContent = '' }); await frame.getByRole('button', { name: 'Measure' }).click()
      await expect.poll(() => output.textContent()).not.toBe('')
      return JSON.parse((await output.textContent())!)
    }
    const iframeBefore = await sampleIframe()
    await page.evaluate(() => { document.querySelector<HTMLElement>('[data-flow-paper-scroll]')!.scrollTop = 600 })
    const iframeAfter = await sampleIframe()
    expect(iframeAfter.targets.map((target: any) => target.flow.contentFrame)).toEqual(iframeBefore.targets.map((target: any) => target.flow.contentFrame))
    expect(iframeAfter.targets[0].flow.viewport.y).toBe(600)
    expect(iframeAfter.targets[1].flow.contentFrame.transform[5]).toBe(1720)
    const actual = await page.evaluate(() => {
      const iframe = document.querySelector<HTMLIFrameElement>('#reader iframe')!, rect = iframe.getBoundingClientRect(), target = document.getElementById('second')!.getBoundingClientRect(), owner = document.getElementById('reader')!
      ;(window as any).oldGeometryFrame = iframe
      const scale = owner.getBoundingClientRect().width / owner.offsetWidth
      return { x: (target.left - rect.left) / scale, y: (target.top - rect.top) / scale }
    })
    expect(Math.abs(iframeAfter.targets[1].viewportFrame.transform[4] - actual.x)).toBeLessThan(.1)
    expect(Math.abs(iframeAfter.targets[1].viewportFrame.transform[5] - actual.y)).toBeLessThan(.1)
    await page.evaluate(async () => {
      const previous = (window as any).geometryProject, next = { ...previous, revision: 1, definitions: { ...previous.definitions,
        reader: { ...previous.definitions.reader, implementation: { ...previous.definitions.reader.implementation, source: previous.definitions.reader.implementation.source + '\nexport const replacement = 1' } } } }
      await (window as any).geometryWorld.sync(next, { assets: {}, components: {} })
    })
    expect(await page.evaluate(() => document.querySelector('#reader iframe') === (window as any).oldGeometryFrame)).toBe(false)
    const iframeRemounted = await sampleIframe()
    expect(iframeRemounted.targets[1].flow.contentFrame).toEqual(iframeAfter.targets[1].flow.contentFrame)
    evidence.iframe = { before: iframeBefore, after: iframeAfter, actualCallerCoordinates: actual, remounted: iframeRemounted }
    await page.evaluate(async () => { await (window as any).geometryWorld.dispose() })
    expect(await page.locator('#reader iframe').count()).toBe(0)
    expect(errors).toEqual([])
  } finally {
    await mkdir(output, { recursive: true }); await writeFile(resolve(output, 'browser-measurements.json'), JSON.stringify({ evidence, errors }, null, 2))
    await page.evaluate(async () => { await (window as any).geometryPlayer?.dispose(); await (window as any).geometryWorld?.dispose() }).catch(() => {})
    await browser.close()
  }
}, 30_000)
