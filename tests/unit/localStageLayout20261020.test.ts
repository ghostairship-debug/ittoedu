import { testContainerInstance, setRootContainers, createTestProjectFromLegacy } from '../helpers/glxWorkFixture'
import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
// @vitest-environment node
import { expect, it } from 'vitest'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { buildPublishedCourseV3 } from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import { compileCoursePlayback } from '../../src/core/publish/componentPlatform/compileCoursePlayback'
import { buildCompiledSingleHtml } from '../../src/core/publish/componentPlatform/buildSingleHtml'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import { createCourseProjectV10Archive, openCourseProjectV10Archive } from '../../src/core/drivers/codecs/courseProjectV10Archive'
import { authoredDocumentBootstrap, authoredDocumentProgramsSource } from '../../src/components/web/authoredDocumentBootstrap'
import { htmlActionPageOperation } from '../../src/main/workbench/observation/HtmlActionPageScript'

const output = 'output/creation-boundary-implementation-20261020/D'
const markup = `<section id="stage" data-gl-layout="stage" data-gl-variants="wide compact">
<header data-gl-slot="heading">A local activity</header>
<div data-gl-slot="body" id="cards"><p>Read the useful information and compare the two choices. Keep the whole text available.</p>
<aside data-gl-scroll="auxiliary" id="reference">${'<p>Supporting original text remains available by scrolling.</p>'.repeat(18)}</aside></div>
<div data-gl-slot="feedback" id="feedback"></div><nav data-gl-slot="actions"><button id="next">Continue</button></nav></section>`
const css = `html,body{margin:0;width:100%;height:100%}*{box-sizing:border-box}
#stage{font:22px/1.3 Arial;padding:24px;--gl-font-min:20;--gl-gap-min:8px;--gl-gap-max:24px;--gl-padding-min:16px;background:#eff6ff}
header{font-size:28px}p{margin:0}button{font:inherit;padding:10px 22px}
#cards{display:grid;grid-template-columns:1fr 1fr;gap:20px;min-height:440px}
[data-gl-runtime-variant="compact"] #cards{min-height:180px}
#reference{height:140px}#feedback{min-height:0}
@media(max-width:700px){#cards{grid-template-columns:1fr}#reference{height:80px}}`

it('uses the same derived stage policy in Published, compiled playback and offline HTML without changing author data', async () => {
  await mkdir(output, { recursive: true })
  const project = createBlankCourseProjectV10('Local stage layout')
  project.definitions.web = { id: 'web', role: 'content', implementation: { kind: 'builtin', key: 'guoling.web' } }
  project.instances.stage = { id: 'stage', definitionId: 'web', data: { html: markup, css }, frame: { width: 1040, height: 570, transform: [1, 0, 0, 1, 100, 70] } }
  project.instances.stage.locked = true
  project.instances.neighbor = { id: 'neighbor', definitionId: 'web', data: { html: '<p id="neighbor">Independent neighbor</p>' }, frame: { width: 500, height: 45, transform: [1, 0, 0, 1, 100, 10] } }
  testContainerInstance(project, 0).childIds = ['stage', 'neighbor']; testContainerInstance(project, 0).container!.designSize = { width: 1280, height: 720 }
  const original = structuredClone(project)
  const formal = JSON.parse(await readFile('tests/fixtures/creationStageAssembled20261020.json', 'utf8'))
  formal.project = createTestProjectFromLegacy(formal.project)
  const formalBytes = Object.fromEntries(Object.entries(formal.resources.assets).map(([id, bytes]) => [id, new Uint8Array(Object.values(bytes as Record<string, number>))]))
  const formalPublished = await buildPublishedCourseV3({ project: formal.project, assetBytes: formalBytes }, { compilation: new InMemoryComponentCompilation(createEsbuildComponentCompiler()) })
  const flow = structuredClone(project)
  setRootContainers(flow, [{ id: 'flow', kind: 'flow', title: 'Natural article', childIds: ['stage'] }])
  delete flow.instances.neighbor
  ;(flow.instances.stage!.data as { css: string }).css = css.replace('html,body{margin:0;width:100%;height:100%}', '')
  const flowPublished = await buildPublishedCourseV3({ project: flow, assetBytes: {} }, { compilation: new InMemoryComponentCompilation(createEsbuildComponentCompiler()) })
  const nested = createBlankCourseProjectV10('Compiled native child stage')
  nested.definitions.island = { id: 'island', role: 'content', implementation: { kind: 'builtin', key: 'guoling.html-program' } }
  const nestedDocument = `<!doctype html><html><head><style>${css}</style></head><body>${markup}<script>document.querySelector('#next').onclick=()=>{document.querySelector('#feedback').textContent='The longest normal feedback remains readable and the primary Continue action stays inside this local activity.'}</script></body></html>`
  nested.instances.island = { id: 'island', definitionId: 'island', data: { html: `<iframe id="island" style="border:0;width:100%;height:100%" srcdoc="${nestedDocument.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')}"></iframe>` }, frame: { width: 1040, height: 570, transform: [1, 0, 0, 1, 100, 70] } }
  testContainerInstance(nested, 0).childIds = ['island']; testContainerInstance(nested, 0).container!.designSize = { width: 1280, height: 720 }
  const nestedPublished = await buildPublishedCourseV3({ project: nested, assetBytes: {} }, { compilation: new InMemoryComponentCompilation(createEsbuildComponentCompiler()) })
  const cold = openCourseProjectV10Archive(createCourseProjectV10Archive({ project, resources: { assets: {}, components: {} } }))
  expect(cold.project).toEqual(project)
  const published = await buildPublishedCourseV3({ project: cold.project, assetBytes: {} }, { compilation: new InMemoryComponentCompilation(createEsbuildComponentCompiler()) })
  const dom = new JSDOM('<!doctype html>')
  const artifact = await compileCoursePlayback(published.payload, { document: dom.window.document, renderBuiltin: async () => { throw new Error('Unexpected builtin') } })
  const nestedArtifact = await compileCoursePlayback(nestedPublished.payload, { document: dom.window.document, renderBuiltin: async () => { throw new Error('Unexpected builtin') } })
  expect(nestedArtifact.webPrograms.island![0]!.program.nativeData).toBeUndefined()
  dom.window.close()
  expect(artifact.diagnostics).toEqual([])
  const bundle = await build({ stdin: { contents: `export { mountCompiledCourse } from './src/player/componentPlatform/compiledPlayer';export {mountPublishedCourseV3} from './src/player/componentPlatform/publishedPlayer';export {compileCoursePlayback} from './src/core/publish/componentPlatform/compileCoursePlayback';export {renderCompiledBuiltin} from './src/renderer/export/componentPlatform/renderCompiledBuiltin';export {createLocalStageLayout} from './src/components/web/localStageLayout'`, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'CoursewareCompiledPlayer', target: 'es2022' })
  const offlineHtml = buildCompiledSingleHtml(artifact, bundle.outputFiles[0]!.text)
  await writeFile(`${output}/layout-offline.html`, offlineHtml)
  const browser = await chromium.launch({ headless: true })
  const facts: Record<string, unknown> = {}, errors: string[] = [], network: string[] = []
  try {
    const context = await browser.newContext({ offline: true, viewport: { width: 1280, height: 720 } })
    const page = await context.newPage()
    page.setDefaultTimeout(5000)
    page.on('pageerror', error => errors.push(error.message)); page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()) })
    await page.setContent(offlineHtml)
    await writeFile(`${output}/progress.json`, JSON.stringify({ phase: 'content-set', errors }))
    await page.evaluate(() => Promise.race([(window as any).coursePlayerReady,
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error('layout startup: ' + document.body.innerText)), 5000))]))
    await writeFile(`${output}/progress.json`, JSON.stringify({ phase: 'compiled-ready', errors }))
    await writeFile(`${output}/compiled-dom.html`, await page.content())
    await writeFile(`${output}/compiled-shadow.json`, JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('*')].filter(element => element.shadowRoot).map(element => element.shadowRoot!.innerHTML))))
    const stage = artifact.webPrograms.stage![0]!.program.nativeData
      ? page.locator('[data-compiled-runtime-root="stage"] iframe').contentFrame().locator('#stage') : page.locator('#stage')
    await writeFile(`${output}/compiled-initial.json`, JSON.stringify(await stage.evaluate(element => ({ fact: element.getAttribute('data-gl-runtime-layout'),
      body: document.body.outerHTML.slice(0, 4500), css: { display: getComputedStyle(element).display, rows: getComputedStyle(element).gridTemplateRows, gap: getComputedStyle(element).gap },
      children: [...element.children].map(child => ({ tag: child.id || child.getAttribute('data-gl-slot'), minHeight: getComputedStyle(child).minHeight, rect: child.getBoundingClientRect().toJSON() })),
      rect: element.getBoundingClientRect().toJSON(), rootRect: document.body.getBoundingClientRect().toJSON() })), null, 2))
    await expect.poll(() => stage.getAttribute('data-gl-runtime-variant')).toBe('compact')
    const read = async () => stage.evaluate(element => ({ fact: JSON.parse(element.getAttribute('data-gl-runtime-layout')!),
      font: getComputedStyle(element).fontSize, button: element.querySelector('button')!.getBoundingClientRect().toJSON(),
      rect: element.getBoundingClientRect().toJSON(), referenceScrolls: element.querySelector('#reference')!.scrollHeight > element.querySelector('#reference')!.clientHeight }))
    await expect.poll(async () => (await read()).fact.issues).toEqual([])
    facts.compiled570 = await read()
    await stage.locator('#feedback').evaluate(element => { element.textContent = 'This is the longest normal feedback. It must wrap naturally and keep the Continue button fully visible, with the original text still available.' })
    await expect.poll(async () => (await read()).fact.issues).toEqual([])
    facts.longFeedback = await read()
    await page.screenshot({ path: `${output}/compiled-long-feedback.png` })
    expect((facts.longFeedback as any).font).toBe('22px')
    expect((facts.longFeedback as any).referenceScrolls).toBe(true)
    expect((facts.longFeedback as any).button.bottom).toBeLessThanOrEqual((facts.longFeedback as any).rect.bottom)
    // A real manual override wins; the projection reports the resulting inability instead of rewriting it.
    await stage.evaluate(element => { (element as HTMLElement).style.padding = '250px 24px' })
    await expect.poll(async () => (await read()).fact.needsContentDecision).toBe(true)
    facts.impossible = await read()
    expect((facts.impossible as any).fact.tried).toHaveLength(4)
    expect(await stage.evaluate(element => (element as HTMLElement).style.padding)).toBe('250px 24px')
    await stage.evaluate(element => { (element as HTMLElement).style.padding = '' })
    await expect.poll(async () => (await read()).fact.issues).toEqual([])
    facts.observed = await stage.evaluate((_element, source) => (0, eval)(`(${source})({type:'observe'})`), htmlActionPageOperation.toString())
    expect((facts.observed as any).diagnostics.some((value: string) => value.startsWith('局部布局'))).toBe(true)
    expect(await page.locator('#course-diagnostic').getAttribute('role')).not.toBe('alert')
    await page.evaluate(() => (window as any).coursePlayer.dispose())

    await page.setContent('<style>html,body,#player{margin:0;width:100%;height:100%}</style><main id="player"></main>')
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text })
    await page.evaluate(async (serialized: string) => {
      const value = JSON.parse(serialized)
      const model = { kind: 'course-v10', project: value.project, resources: { assets: {}, components: {} } }
      ;(window as any).layoutModel = model
      ;(window as any).modelPlayer = await (window as any).CoursewareCompiledPlayer.mountPublishedCourseV3(value.payload, document.getElementById('player'), { report: console.warn })
      await (window as any).modelPlayer.ready
    }, JSON.stringify({ project, payload: published.payload }))
    await writeFile(`${output}/runtime-dom.html`, await page.content())
    await writeFile(`${output}/runtime-frames.json`, JSON.stringify(await Promise.all(page.frames().map(async frame => ({ url: frame.url(), html: (await frame.content()).slice(0, 12000) }))), null, 2))
    const frame = page.locator('[data-component-object="stage"] iframe').contentFrame()
    const runtimeStage = frame.locator('#stage')
    await expect.poll(() => runtimeStage.getAttribute('data-gl-runtime-variant')).toBe('compact')
    await expect.poll(async () => JSON.parse((await runtimeStage.getAttribute('data-gl-runtime-layout'))!).issues).toEqual([])
    facts.runtime570 = JSON.parse((await runtimeStage.getAttribute('data-gl-runtime-layout'))!)
    for (const [width, height] of [[1040, 590], [620, 570]]) {
      await page.evaluate(async ({ width, height }) => { const model = (window as any).layoutModel; model.project.instances.stage.frame.width = width; model.project.instances.stage.frame.height = height; await (window as any).modelPlayer.update(model) }, { width, height })
      await expect.poll(async () => JSON.parse((await runtimeStage.getAttribute('data-gl-runtime-layout'))!).viewport.inlineSize).toBe(width)
      await expect.poll(async () => JSON.parse((await runtimeStage.getAttribute('data-gl-runtime-layout'))!).issues).toEqual([])
      facts[`runtime${width}x${height}`] = JSON.parse((await runtimeStage.getAttribute('data-gl-runtime-layout'))!)
    }
    await page.evaluate(async () => {
      const model = structuredClone((window as any).layoutModel), data = model.project.instances.stage.data
      ;(window as any).layoutModel = model
      ;(window as any).previousLayoutCss = data.css
      data.css = data.css.replace('min-height:440px', 'min-height:900px').replace('min-height:180px', 'min-height:900px')
      await (window as any).modelPlayer.update(model)
    })
    await expect.poll(async () => JSON.parse((await runtimeStage.getAttribute('data-gl-runtime-layout'))!).needsContentDecision).toBe(true)
    facts.cssUpdate = JSON.parse((await runtimeStage.getAttribute('data-gl-runtime-layout'))!)
    await page.evaluate(async () => { const model = structuredClone((window as any).layoutModel); (window as any).layoutModel = model; model.project.instances.stage.data.css = (window as any).previousLayoutCss; await (window as any).modelPlayer.update(model) })
    await expect.poll(async () => JSON.parse((await runtimeStage.getAttribute('data-gl-runtime-layout'))!).issues).toEqual([])
    const beforeDispose = await runtimeStage.getAttribute('data-gl-runtime-layout')
    const expectedAuthor = structuredClone(project)
    expectedAuthor.instances.stage!.frame!.width = 620
    facts.resultingAuthorProject = await page.evaluate(() => (window as any).layoutModel.project)
    expect(facts.resultingAuthorProject).toEqual(expectedAuthor)
    await page.evaluate(() => (window as any).modelPlayer.dispose())
    expect(beforeDispose).toBeTruthy()
    expect(await page.locator('[data-component-object="stage"]').count()).toBe(0)
    expect(project).toEqual(original)

    // Native parser documents use the same factory, without persisting helper scripts in the authored HTML.
    const nativeHtml = authoredDocumentBootstrap({ html: '<!doctype html><html><head><style>' + css + '</style></head><body>' + markup + '</body></html>' },
      { nonce: 'native-stage', instanceId: 'native', resources: {}, bridge: authoredDocumentProgramsSource })
    await page.setViewportSize({ width: 1040, height: 570 }); await page.setContent(nativeHtml)
    await expect.poll(async () => JSON.parse((await page.locator('#stage').getAttribute('data-gl-runtime-layout')) ?? '{}').issues).toEqual([])
    facts.native = JSON.parse((await page.locator('#stage').getAttribute('data-gl-runtime-layout'))!)
    facts.nativeObservation = await page.evaluate(source => (0, eval)(`(${source})({type:'observe'})`), htmlActionPageOperation.toString())
    expect((facts.nativeObservation as any).diagnostics.some((value: string) => value.startsWith('局部布局'))).toBe(true)
    await page.locator('#feedback').evaluate(async element => {
      const image = document.createElement('img'); image.alt = 'Late image'; image.width = 80; image.height = 48; element.append(image)
      image.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="80" height="48"><rect width="80" height="48" fill="green"/></svg>'
      await image.decode()
      const font = new FontFace('LateStage', 'local(Arial)'); document.fonts.add(await font.load())
      ;(element as HTMLElement).style.fontFamily = 'LateStage'
    })
    await expect.poll(async () => JSON.parse((await page.locator('#stage').getAttribute('data-gl-runtime-layout'))!).issues).toEqual([])
    facts.lateResources = JSON.parse((await page.locator('#stage').getAttribute('data-gl-runtime-layout'))!)

    await page.setContent('<style>html,body,#player{margin:0;width:100%;height:100%}</style><main id="player"></main>')
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text })
    facts.formalAssembly = await page.evaluate(async serialized => {
      const api = (window as any).CoursewareCompiledPlayer, payload = JSON.parse(serialized)
      const artifact = await api.compileCoursePlayback(payload, { document, renderBuiltin: (instance: unknown, key: string, project: unknown) => api.renderCompiledBuiltin(instance, key, project, document) })
      ;(window as any).formalPlayer = await api.mountCompiledCourse(artifact, document.getElementById('player'))
      return { diagnostics: artifact.diagnostics, native: Object.values(artifact.webPrograms).map((entries: any) => Boolean(entries[0].program.nativeData)) }
    }, JSON.stringify(formalPublished.payload))
    const formalWeb = Object.values(formal.project.instances).find((instance: any) => instance.data.html?.includes('data-gl-layout')) as any
    const formalStage = (facts.formalAssembly as any).native[0]
      ? page.locator(`[data-compiled-runtime-root="${formalWeb.id}"] iframe`).contentFrame().locator('#stage') : page.locator('#stage')
    await expect.poll(async () => JSON.parse((await formalStage.getAttribute('data-gl-runtime-layout')) ?? '{}').issues).toEqual([])
    facts.formalStage = JSON.parse((await formalStage.getAttribute('data-gl-runtime-layout'))!)
    expect((facts.formalAssembly as any).diagnostics).toEqual([])
    expect(await page.getByText('Independent title', { exact: true }).textContent()).toBe('Independent title')
    expect(formalWeb.data.html).not.toContain('data-gl-runtime'); expect(formalWeb.data.html).not.toContain('<script')
    await page.evaluate(() => (window as any).formalPlayer.dispose())

    await page.setContent(buildCompiledSingleHtml(nestedArtifact, bundle.outputFiles[0]!.text))
    await page.evaluate(() => (window as any).coursePlayerReady)
    const childStage = page.locator('#island').contentFrame().locator('#stage')
    await expect.poll(() => childStage.getAttribute('data-gl-runtime-variant')).toBe('compact')
    await childStage.locator('#next').click()
    await expect.poll(async () => JSON.parse((await childStage.getAttribute('data-gl-runtime-layout'))!).issues).toEqual([])
    facts.compiledNested = JSON.parse((await childStage.getAttribute('data-gl-runtime-layout'))!)
    expect((facts.compiledNested as any).viewport.inlineSize).toBe(1040)
    expect(await childStage.locator('#feedback').textContent()).toContain('longest normal feedback')
    await page.evaluate(() => (window as any).coursePlayer.dispose())
    await page.setContent('<style>html,body,#player{margin:0;width:100%;height:100%}</style><main id="player"></main>')
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text })

    await page.evaluate(async serialized => {
      ;(window as any).flowPlayer = await (window as any).CoursewareCompiledPlayer.mountPublishedCourseV3(JSON.parse(serialized), document.getElementById('player'))
    }, JSON.stringify(flowPublished.payload))
    const flowStage = page.locator('[data-component-object="stage"] iframe').contentFrame().locator('#stage')
    await expect.poll(async () => JSON.parse((await flowStage.getAttribute('data-gl-runtime-layout')) ?? '{}').viewport?.mode).toBe('flow-content')
    await expect.poll(async () => JSON.parse((await flowStage.getAttribute('data-gl-runtime-layout'))!).issues).toEqual([])
    facts.flow = JSON.parse((await flowStage.getAttribute('data-gl-runtime-layout'))!)
    expect((facts.flow as any).contentBox.blockSize).toBeGreaterThan(570)
    await page.evaluate(() => (window as any).flowPlayer.dispose())

    await page.evaluate(() => {
      const api = (window as any).CoursewareCompiledPlayer, root = document.getElementById('player')!
      root.innerHTML = '<section data-gl-layout="stage"><div data-gl-slot="body">Current generation</div><nav data-gl-slot="actions"><button>Continue</button></nav></section>'
      const old = api.createLocalStageLayout(root), current = api.createLocalStageLayout(root)
      old.refresh(); old.dispose(); (window as any).generationLayout = current
    })
    await expect.poll(() => page.locator('[data-gl-layout]').getAttribute('data-gl-runtime-layout')).toBeTruthy()
    facts.generation = await page.locator('[data-gl-layout]').getAttribute('data-gl-runtime-layout')
    await page.evaluate(() => (window as any).generationLayout.dispose())
    expect(await page.locator('[data-gl-runtime-layout]').count()).toBe(0)
    await page.evaluate(() => {
      const root = document.getElementById('player')!
      root.innerHTML = `<section id="clip-stage" data-gl-layout="stage" style="--gl-font-min:20">
        <div data-gl-slot="body" style="height:40px;overflow:hidden;white-space:nowrap">${'Overlong unwrapped content '.repeat(18)}
        <div style="height:30px;overflow:auto"><aside data-gl-scroll="auxiliary" style="height:20px;margin-bottom:80px">${'<p>Auxiliary text</p>'.repeat(12)}</aside></div></div>
        <nav data-gl-slot="actions"><div style="height:10px;overflow:hidden"><button style="height:40px;font-size:10px">Continue</button></div></nav></section>`
      ;(window as any).clipLayout = (window as any).CoursewareCompiledPlayer.createLocalStageLayout(root)
    })
    await expect.poll(async () => JSON.parse((await page.locator('#clip-stage').getAttribute('data-gl-runtime-layout')) ?? '{}').needsContentDecision).toBe(true)
    facts.clipping = JSON.parse((await page.locator('#clip-stage').getAttribute('data-gl-runtime-layout'))!)
    expect((facts.clipping as any).issues.map((issue: any) => issue.code)).toEqual(expect.arrayContaining([
      'horizontal-overflow', 'clipped-content', 'primary-action-clipped', 'font-below-declared-minimum', 'nested-scroll',
    ]))
    await page.locator('#clip-stage [data-gl-slot="body"]').evaluate(element => { (element as HTMLElement).style.display = 'none' })
    await page.locator('#clip-stage button').evaluate(element => { (element as HTMLElement).style.opacity = '0' })
    await expect.poll(async () => JSON.parse((await page.locator('#clip-stage').getAttribute('data-gl-runtime-layout'))!).issues.map((issue: any) => issue.code))
      .toEqual(expect.arrayContaining(['body-hidden', 'primary-actions-unreachable']))
    facts.hidden = JSON.parse((await page.locator('#clip-stage').getAttribute('data-gl-runtime-layout'))!)
    await page.evaluate(() => (window as any).clipLayout.dispose())
    await page.evaluate(() => {
      const root = document.getElementById('player')!
      root.innerHTML = '<section id="border-stage" data-gl-layout="stage"><div data-gl-slot="body">Body</div><nav data-gl-slot="actions" style="height:80px;border:20px solid;overflow:hidden;position:relative"><button style="position:absolute;top:-15px;left:20px;height:10px;padding:0;margin:0;font-size:10px;line-height:10px">Continue</button></nav></section>'
      ;(window as any).borderLayout = (window as any).CoursewareCompiledPlayer.createLocalStageLayout(root)
    })
    await expect.poll(async () => JSON.parse((await page.locator('#border-stage').getAttribute('data-gl-runtime-layout')) ?? '{"issues":[]}').issues.map((issue: any) => issue.code))
      .toEqual(expect.arrayContaining(['primary-action-clipped']))
    facts.borderClip = JSON.parse((await page.locator('#border-stage').getAttribute('data-gl-runtime-layout'))!)
    await page.evaluate(() => (window as any).borderLayout.dispose())
    expect(markup).not.toContain('data-gl-runtime'); expect(markup).not.toContain('<script')
    expect(errors).toEqual([]); expect(network).toEqual([])
    await writeFile(`${output}/layout-facts.json`, JSON.stringify({ facts, errors, network }, null, 2))
  } finally { await writeFile(`${output}/layout-attempt-latest.json`, JSON.stringify({ facts, errors, network }, null, 2)); await browser.close() }
}, 60000)
