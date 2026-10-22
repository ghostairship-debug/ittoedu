// @vitest-environment node
import { beforeAll as prepareProgramSourceForTests } from 'vitest'
import { loadBuiltinComponentSource } from '../../src/core/components/source/builtinSources'
prepareProgramSourceForTests(async () => { await loadBuiltinComponentSource('guoling.html-program') })
import { expect, it } from 'vitest'
import { build } from 'esbuild'
import { chromium, type Locator, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'
import { createBlankProgramProject, createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { resolveComponentOuterPresentation } from '../../src/shared/componentPresentation'
import { buildPublishedCourseV4 } from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import { compileCoursePlayback } from '../../src/core/publish/componentPlatform/compileCoursePlayback'
import { buildCompiledSingleHtml } from '../../src/core/publish/componentPlatform/buildSingleHtml'
import { setRootContainers } from '../helpers/glxWorkFixture'

async function clickPaintedFrameControl(page: Page, frame: Locator, control: Locator) {
  // Playwright's cross-origin frame locator omits an ancestor CSS scale in
  // its click coordinates. Send the real pointer at the painted frame point.
  const frameBox = (await frame.boundingBox())!, button = await control.evaluate(element => {
    const rect = element.getBoundingClientRect()
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, width: window.innerWidth, height: window.innerHeight }
  })
  const point = { x: frameBox.x + button.x * frameBox.width / button.width, y: frameBox.y + button.y * frameBox.height / button.height }
  const before = await control.textContent()
  await page.mouse.click(point.x, point.y)
  return { before, frameBox, innerControlCenter: button, point }
}

it('gives an explicit program root the real viewport without a fixed presentation frame', () => {
  const project = createBlankProgramProject(), root = project.instances[project.rootIds[0]]!
  const presentation = resolveComponentOuterPresentation(project, root, {
    placement: 'free', purpose: 'author', inlineSize: 900, viewport: { width: 900, height: 480 },
  })
  expect(presentation.layoutInput).toEqual({ mode: 'program-viewport', inlineSize: 900, blockSize: 480 })
  expect(presentation.outerStyle).toMatchObject({ width: '100%', height: '100%', transform: 'none' })
  expect(presentation.contentStyle.height).toBe('100%')
  expect(root.frame).toBeUndefined()
  expect(root.container).toBeUndefined()
})

it('retains the ordinary free frame contract inside a presentation container', () => {
  const project = createBlankCourseProjectV10()
  const instance = { id: 'native', definitionId: 'native', data: {}, frame: { width: 320, height: 180, transform: [1, 0, 0, 1, 10, 20] as [number, number, number, number, number, number] } }
  project.instances.native = instance
  project.definitions.native = { id: 'native', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } }
  project.instances[project.rootIds[0]]!.childIds!.push('native')
  const presentation = resolveComponentOuterPresentation(project, instance, { placement: 'free', purpose: 'author', inlineSize: 900 })
  expect(presentation.layoutInput).toEqual({ mode: 'free-frame', inlineSize: 320, blockSize: 180 })
  expect(presentation.outerStyle.transform).toBe('matrix(1,0,0,1,10,20)')
})

it('preserves a bounded local program frame in Flow without recognition CSS, including an implementation override', () => {
  const project = createBlankCourseProjectV10()
  project.definitions.web = { id: 'web', role: 'content', implementation: { kind: 'builtin', key: 'guoling.web' } }
  const instance = { id: 'local-program', definitionId: 'web',
    implementationOverride: { kind: 'builtin' as const, key: 'guoling.html-program' },
    data: { html: '<!doctype html><html><body><button>Continue</button></body></html>' },
    frame: { width: 640, height: 360, transform: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number] } }
  project.instances[instance.id] = instance
  project.instances[project.rootIds[0]]!.childIds!.push(instance.id)
  for (const purpose of ['author', 'playback'] as const) {
    const presentation = resolveComponentOuterPresentation(project, instance, { placement: 'flow', purpose, inlineSize: 480 })
    expect(presentation.layoutInput).toEqual({ mode: 'flow-viewport', inlineSize: 640, blockSize: 360 })
    expect(presentation.stageStyle.height).toBe('270px')
    expect(presentation.contentStyle).toMatchObject({ width: '640px', height: '360px', transform: 'scale(0.75) translate(0px,0px)' })
  }
  instance.data.html = instance.data.html.replace('Continue', 'Updated')
  expect(resolveComponentOuterPresentation(project, instance, { placement: 'flow', purpose: 'author', inlineSize: 480 }).stageStyle.height).toBe('270px')
  expect(instance.frame.height).toBe(360)
})

it('delivers the bounded viewport and lets ordinary Flow grow in the actual offline player', async () => {
  const project = createBlankCourseProjectV10('Flow program layout regression')
  project.definitions.web = { id: 'web', role: 'content', implementation: { kind: 'builtin', key: 'guoling.web' } }
  project.instances.program = { id: 'program', definitionId: 'web', implementationOverride: { kind: 'builtin', key: 'guoling.html-program' },
    frame: { width: 640, height: 360, transform: [1, 0, 0, 1, 0, 0] }, data: { html: '<!doctype html><html><head><style>@media(max-width:500px){h1{color:red}}</style></head><body><h1>Bounded program</h1><button id="apply" onclick="this.textContent=\'Applied\'">Apply</button></body></html>' } }
  project.instances.article = { id: 'article', definitionId: 'web', frame: { width: 640, height: 80, transform: [1, 0, 0, 1, 0, 0] },
    data: { html: '<section><p>Natural reading block</p><button id="grow" onclick="const p=document.createElement(\'p\');p.textContent=\'More reading content\';p.style.height=\'180px\';this.parentNode.append(p)">Add content</button></section>' } }
  setRootContainers(project, [{ id: 'flow', kind: 'flow', title: 'Flow', childIds: ['program', 'article'],
    flow: { layout: { readingWidth: 640, wideContentWidth: 640, toc: 'hidden' } } }])
  const before = structuredClone(project)
  const published = await buildPublishedCourseV4({ project, assetBytes: {} })
  const dom = new JSDOM('<!doctype html>')
  const artifact = await compileCoursePlayback(published.payload, { document: dom.window.document, renderBuiltin: async () => { throw new Error('Unexpected static builtin') } })
  dom.window.close()
  expect(artifact.webPrograms.program[0]!.program.nativeData).toBeDefined()
  const bundle = await build({ stdin: { contents: "export {mountCompiledCourse} from './src/player/componentPlatform/compiledPlayer'", resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, format: 'iife', globalName: 'CoursewareCompiledPlayer', platform: 'browser', target: 'es2022' })
  const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1000, height: 800 } })
  page.setDefaultTimeout(5000)
  const errors: string[] = [], metrics: Record<string, unknown> = {}
  page.on('pageerror', error => errors.push(error.message))
  const output = process.env.COFFEE_LAYOUT_EVIDENCE_DIR
  try {
    const html = buildCompiledSingleHtml(artifact, bundle.outputFiles[0]!.text)
    if (output) {
      await mkdir(output, { recursive: true })
      const file = join(output, 'layout-regression.html')
      await writeFile(file, html)
      await page.goto(pathToFileURL(join(process.cwd(), file)).href)
    } else await page.setContent(html)
    await page.evaluate(async () => { await (window as unknown as { coursePlayerReady: Promise<unknown> }).coursePlayerReady })
    const program = page.locator('[data-compiled-runtime-root="program"]'), frame = program.locator('iframe')
    const read = async () => ({ outer: await program.evaluate(element => ({ width: element.clientWidth, height: element.clientHeight })),
      inner: await frame.contentFrame().locator('body').evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })) })
    metrics.program = await read()
    if (output) await page.screenshot({ path: join(output, 'layout-regression.png'), fullPage: true })
    expect(metrics.program).toEqual({ outer: { width: 640, height: 360 }, inner: { width: 640, height: 360 } })
    const apply = frame.contentFrame().locator('#apply')
    metrics.programInput = await clickPaintedFrameControl(page, frame, apply)
    await expect.poll(() => apply.textContent()).toBe('Applied')
    metrics.programFeedback = await apply.textContent()
    const article = page.locator('[data-compiled-runtime-root="article"]')
    const initialHeight = await article.evaluate(element => element.clientHeight)
    const articleFrame = article.locator('iframe')
    metrics.articleInput = await clickPaintedFrameControl(page, articleFrame, articleFrame.contentFrame().locator('#grow'))
    await expect.poll(() => article.evaluate(element => element.clientHeight)).toBeGreaterThan(initialHeight)
    const content = await articleFrame.contentFrame().locator('section > p:last-child').evaluate(element => ({
      text: element.textContent, bottom: element.getBoundingClientRect().bottom, viewportHeight: window.innerHeight,
    }))
    metrics.article = { initialHeight, grownHeight: await article.evaluate(element => element.clientHeight), content }
    expect(content.text).toBe('More reading content')
    expect(content.viewportHeight).toBeGreaterThanOrEqual(content.bottom)
    if (output) await page.screenshot({ path: join(output, 'layout-regression.png'), fullPage: true })
    expect(await read()).toEqual(metrics.program)
    expect(await page.locator('#course-diagnostic').isHidden()).toBe(true)
    expect(errors).toEqual([])
    expect(project).toEqual(before)
  } finally {
    if (output) await writeFile(join(output, 'layout-regression-facts.json'), JSON.stringify({ metrics, errors }, null, 2))
    await browser.close()
  }
}, 30000)
