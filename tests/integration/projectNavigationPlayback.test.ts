// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest'
import { build } from 'esbuild'
import { chromium, type Browser, type Page } from 'playwright'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { normalizeCourseProject } from '../../src/core/course/normalizeCourseProject'
import { mapHtmlInteractions, type HtmlInteractionPage } from '../../src/core/projectFiles/htmlInteractions'
import { parsePageHtml } from '../../src/core/projectFiles/pageHtml'
import { slidePageFiles } from '../../src/core/projectFiles/projectFileView'
import { planPageWrite } from '../../src/core/projectFiles/slidePages'
import { parseWebComposition } from '../../src/main/workbench/htmlImport/parseWebComposition'
import { buildPublishedCourseV2Payload } from '../../src/renderer/export/course/buildPublishedCourse'
import type { CompositionLayerItem, CourseProjectDocument } from '../../src/shared/courseProjectTypes'
import { spatialStopsProject } from '../helpers/spatialStopsFixture'

let browser: Browser
let bundle: string

beforeAll(async () => {
  bundle = (await build({
    stdin: {
      contents: `export {createPublishedCourseSession} from './src/player/surfaces/publishedDynamicHosts';`,
      resolveDir: process.cwd(), loader: 'ts',
    },
    bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'NavigationPlayback',
    define: { 'process.env.NODE_ENV': '"test"' },
  })).outputFiles[0]!.text
  browser = await chromium.launch({ headless: true })
}, 30_000)

afterAll(async () => { await browser?.close() })

async function open(project: CourseProjectDocument, initialLocationId = project.startLocationId): Promise<Page> {
  const payload = buildPublishedCourseV2Payload({ project, assetFiles: {}, components: {} })
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  page.setDefaultTimeout(2500)
  await page.context().setOffline(true)
  await page.setContent('<div id="host" style="position:relative;width:1280px;height:720px"></div>')
  await page.addScriptTag({ content: bundle })
  await page.evaluate(async ({ payload, initialLocationId }) => {
    const session = (window as any).NavigationPlayback.createPublishedCourseSession(payload, { initialLocationId })
    Object.assign(window, { session })
    await session.mount(document.getElementById('host'))
  }, { payload, initialLocationId })
  return page
}

const location = (page: Page) => page.evaluate(() => (window as any).session.navigator.current.locationId)

async function close(page: Page): Promise<void> {
  try { await page.evaluate(() => (window as any).session?.destroy()) }
  finally { await page.close() }
}

it('real Slide clicks reveal and toggle a hidden answer, then follow a relative link to the other course page', async () => {
  let project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
  let next = 0
  for (const [path, html] of [
    ['slides/01-导入.html', `<!doctype html><html><body>
      <a href="#answer"><span>显示答案</span></a>
      <button aria-controls="answer">切换答案</button>
      <div id="answer" hidden>地轴倾斜</div>
      <p class="fragment">公转过程中地轴倾斜方向保持不变</p>
      <a href="../slides/02-观察.html"><span>继续观察</span></a>
    </body></html>`],
    ['slides/02-观察.html', '<!doctype html><html><body><h1>第二页观察</h1></body></html>'],
  ] as const) {
    project = planPageWrite({ project, resources: { assets: {}, components: {} }, path, html,
      parse: parseWebComposition, createId: () => `navigation-${++next}` }).project
  }
  const pages: HtmlInteractionPage[] = slidePageFiles(project).map(page => ({
    path: page.path, locationId: page.locationId, sceneId: page.sceneId,
    items: page.scene.layerItems.filter((item): item is CompositionLayerItem => item.kind === 'composition'),
  }))
  for (const source of pages) {
    const mapped = mapHtmlInteractions({ page: source, pages, nodeAddress: (layer, node) => `${layer}/${node}` })
    const surface = project.surfaces.find(surface => surface.type === 'slide' && surface.scenes.some(scene => scene.id === source.sceneId))!
    if (surface.type !== 'slide') throw new Error('Expected Slide fixture')
    surface.scenes.find(scene => scene.id === source.sceneId)!.interactions.push(...mapped.rules)
    project.courseState.push(...mapped.state)
  }
  const [source, target] = pages
  const page = await open(normalizeCourseProject(project), source!.locationId)
  try {
    const frame = page.frameLocator(`iframe[data-web-composition="${source!.items[0]!.layerItemId}"]`)
    const answer = frame.locator('#answer')
    await answer.waitFor({ state: 'attached' })
    expect(await answer.isVisible()).toBe(false)
    await frame.getByRole('link', { name: '显示答案' }).click()
    await expect.poll(() => answer.isVisible(), { timeout: 1500 }).toBe(true)
    expect(await page.evaluate(() => (window as any).session.nextStep())).toBe(true)
    await frame.locator('.fragment').waitFor({ state: 'visible' })
    await expect.poll(() => answer.isVisible(), { timeout: 1500 }).toBe(true)
    expect(Object.values(await page.evaluate(() => (window as any).session.readCourseStateSnapshot()))).toEqual([true])
    await frame.getByRole('button', { name: '切换答案' }).click()
    await expect.poll(() => answer.isVisible(), { timeout: 1500 }).toBe(false)
    await frame.getByRole('button', { name: '切换答案' }).click()
    await expect.poll(() => answer.isVisible(), { timeout: 1500 }).toBe(true)
    expect(await page.evaluate(() => (window as any).session.replayScene())).toBe(true)
    await expect.poll(() => answer.isVisible(), { timeout: 1500 }).toBe(false)
    expect(Object.values(await page.evaluate(() => (window as any).session.readCourseStateSnapshot()))).toEqual([false])
    await frame.getByRole('button', { name: '切换答案' }).click()
    await expect.poll(() => answer.isVisible(), { timeout: 1500 }).toBe(true)
    await frame.getByRole('link', { name: '继续观察' }).click()
    await expect.poll(() => location(page), { timeout: 1500 }).toBe(target!.locationId)
    await page.frameLocator(`iframe[data-web-composition="${target!.items[0]!.layerItemId}"]`)
      .getByRole('heading', { name: '第二页观察' }).waitFor({ state: 'visible' })
    await page.evaluate(locationId => (window as any).session.goToLocation(locationId), source!.locationId)
    expect(await location(page)).toBe(source!.locationId)
    await expect.poll(() => answer.isVisible(), { timeout: 1500 }).toBe(false)
    await frame.getByRole('button', { name: '切换答案' }).click()
    await expect.poll(() => answer.isVisible(), { timeout: 1500 }).toBe(true)
  } finally { await close(page) }
})

it('a real link inside a Spatial composition advances the actual course location to another stop', async () => {
  const project = spatialStopsProject()
  const surface = project.surfaces.find(surface => surface.type === 'spatial-2d')!
  if (surface.type !== 'spatial-2d') throw new Error('Expected Spatial fixture')
  const card = surface.world.layerItems.find(item => item.layerItemId === 'a')!
  if (card.kind !== 'composition') throw new Error('Expected composition card')
  const parsed = parsePageHtml('<!doctype html><html><body><h2>甲卡</h2><a href="#stop-b"><span>前往乙卡</span></a></body></html>',
    { parse: parseWebComposition, assets: {} })
  if (parsed.kind !== 'composition') throw new Error('Expected static HTML composition')
  card.content = parsed.content
  const source: HtmlInteractionPage = { path: 'spaces/旅程.html', locationId: 'stop-a', items: [card],
    anchors: new Map([['stop-a', 'stop-a'], ['stop-b', 'stop-b']]) }
  const mapped = mapHtmlInteractions({ page: source, pages: [source], nodeAddress: (layer, node) => `${layer}/${node}` })
  project.globalInteractions.push(...mapped.rules)
  project.courseState.push(...mapped.state)
  const page = await open(project, 'stop-a')
  try {
    const frame = page.frameLocator('iframe[data-web-composition="a"]')
    await frame.getByRole('link', { name: '前往乙卡' }).waitFor({ state: 'visible' })
    expect(await location(page)).toBe('stop-a')
    await frame.getByRole('link', { name: '前往乙卡' }).click()
    await expect.poll(() => location(page), { timeout: 1500 }).toBe('stop-b')
    await page.frameLocator('iframe[data-web-composition="b"]').getByRole('heading', { name: 'b', exact: true })
      .waitFor({ state: 'visible' })
  } finally { await close(page) }
})
