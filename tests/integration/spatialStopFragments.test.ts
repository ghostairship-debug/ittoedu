// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest'
import { build } from 'esbuild'
import { chromium, type Browser, type Page } from 'playwright'
import { buildPublishedCourseV2Payload } from '../../src/renderer/export/course/buildPublishedCourse'
import { spatialStopsProject } from '../helpers/spatialStopsFixture'
import { addCourseFlowPage } from '../../src/core/tools/courseLocations'

let browser: Browser
let bundle: string
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    export {createPublishedCourseSession} from './src/player/surfaces/publishedDynamicHosts';
    export {attachPublishedCoursePresenter} from './src/player/publishedCoursePresenter';
    export {mountWebComposition} from './src/player/composition/mountWebComposition';
    export {createPublishedSurfaceRuntimeSession} from './src/player/surfaces/runtime/publishedSurfaceRuntimeMount';
    export {mountSpatialLocationTryRun} from './src/renderer/ui/spatialLocationTryRun';
    export {createDefaultTeacherControllerPackage} from './src/shared/defaultTeacherControllerComponent';
  `, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'SpatialTest', define: { 'process.env.NODE_ENV': '"test"' } })).outputFiles[0]!.text
  browser = await chromium.launch({ headless: true })
}, 30000)
afterAll(async () => { await browser?.close() })

async function open(project = spatialStopsProject()): Promise<Page> {
  const payload = buildPublishedCourseV2Payload({ project, assetFiles: {}, components: {} })
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  await page.setContent('<div id="host" style="width:1280px;height:720px"></div>')
  await page.addScriptTag({ content: bundle })
  await page.evaluate(async payload => {
    const api = (window as any).SpatialTest
    const session = api.createPublishedCourseSession(payload)
    const host = document.getElementById('host')!
    await session.mount(host)
    Object.assign(window, { session, presenter: api.attachPublishedCoursePresenter(host, session, payload) })
  }, payload)
  await page.frameLocator('iframe[data-web-composition="a"]').locator('[data-composition-node="a-step-2"]').waitFor({ state: 'attached' })
  return page
}

const fragment = (page: Page, item: string, step: number) => page.frameLocator(`iframe[data-web-composition="${item}"]`).locator(`[data-composition-node="${item}-step-${step}"]`)
async function hidden(page: Page, item: string, step: number) {
  return fragment(page, item, step).evaluate(node => node.hasAttribute('data-guoling-step-hidden'))
}
const progress = (page: Page) => page.evaluate(() => (window as any).session.getPlaybackProgress())
async function move(page: Page, method: 'nextStep' | 'previousStep') {
  expect(await page.evaluate(method => (window as any).session[method](), method)).toBe(true)
}

it('the real Published player reveals in-stop fragments before moving, reverses, reenters and retains turned camera and composition instances', async () => {
  const page = await open()
  try {
    await move(page, 'nextStep') // overview -> arrival at A
    expect(await hidden(page, 'a', 1)).toBe(true)
    expect(await progress(page)).toMatchObject({ stepIndex: 1, stepCount: 7 })
    await page.evaluate(() => { (window as any).originalCard = document.querySelector('iframe[data-web-composition="a"]'); (window as any).originalNode = (window as any).originalCard.contentDocument.querySelector('[data-composition-node="a-step-1"]') })
    const camera = await page.locator('[data-spatial-world]').getAttribute('transform')
    expect(camera).toContain('rotate(-30)')
    // The same keyboard/presenter owner consumes the expanded sequence.
    await page.keyboard.press('PageDown')
    await expect.poll(() => progress(page)).toMatchObject({ stepIndex: 2 })
    expect(await hidden(page, 'a', 1)).toBe(false)
    expect(await hidden(page, 'a', 2)).toBe(true)
    await move(page, 'nextStep')
    expect(await hidden(page, 'a', 2)).toBe(false)
    expect(await page.locator('[data-spatial-world]').getAttribute('transform')).toBe(camera)
    expect(await page.evaluate(() => { const w = window as any; return w.originalCard === document.querySelector('iframe[data-web-composition="a"]') && w.originalNode === w.originalCard.contentDocument.querySelector('[data-composition-node="a-step-1"]') })).toBe(true)
    await move(page, 'nextStep') // arrival B
    expect(await page.evaluate(() => (window as any).session.navigator.current.locationId)).toBe('stop-b')
    expect(await hidden(page, 'a', 2)).toBe(false)
    expect(await hidden(page, 'b', 1)).toBe(true)
    await move(page, 'previousStep') // back to A's final fragment
    expect(await progress(page)).toMatchObject({ stepIndex: 3 })
    expect(await hidden(page, 'a', 2)).toBe(false)
    await move(page, 'previousStep')
    expect(await hidden(page, 'a', 2)).toBe(true)
    await move(page, 'nextStep'); await move(page, 'nextStep'); await move(page, 'nextStep'); await move(page, 'nextStep')
    expect(await page.evaluate(() => (window as any).session.navigator.current.locationId)).toBe('stop-a2')
    expect(await hidden(page, 'a', 2)).toBe(false)
    expect(await page.evaluate(() => (window as any).session.nextStep())).toBe(false)
    await page.evaluate(() => (window as any).session.goToLocation('stop-a'))
    expect(await hidden(page, 'a', 1)).toBe(true)
    expect(await hidden(page, 'b', 1)).toBe(true)
    // Invalid exact states cannot change the current stop or reveal state.
    await expect(page.evaluate(() => (window as any).session.goToObservationTarget('stop-a', 'fragment_step_3'))).rejects.toThrow('Unable to observe')
    expect(await progress(page)).toMatchObject({ stepIndex: 1 })
    await page.evaluate(() => (window as any).session.goToObservationTarget('stop-a', 'fragment_step_2'))
    expect(await hidden(page, 'a', 2)).toBe(false)
    expect(await page.evaluate(() => (window as any).session.replayScene())).toBe(true)
    expect(await progress(page)).toMatchObject({ stepIndex: 0 })
    expect(await hidden(page, 'a', 1)).toBe(true)
  } finally { await page.evaluate(() => (window as any).presenter.destroy()); await page.close() }
})

it('formal Interaction V1 step actions use the same stop fragments and retain course state', async () => {
  const project = spatialStopsProject()
  project.playback.presenter.strategy = 'authored-command'
  project.courseState.push({ key: 'answered', valueType: 'boolean', defaultValue: false })
  project.globalInteractions.push({ id: 'next-rule', enabled: true, trigger: { type: 'presenter.command', command: 'next' }, conditions: [], actions: [
    { id: 'answer-action', start: 'after-previous', delayMs: 0, action: { type: 'course-state.set', key: 'answered', value: true } },
    { id: 'next-action', start: 'after-previous', delayMs: 0, action: { type: 'step.next' } },
  ] })
  const page = await open(project)
  try {
    for (let index = 1; index <= 4; index++) {
      expect(await page.evaluate(() => (window as any).session.dispatchPresenterCommand('next'))).toBe(true)
      await expect.poll(() => progress(page)).toMatchObject({ stepIndex: index })
      await expect.poll(() => page.evaluate(() => (window as any).session.navigator.hasPendingNavigation)).toBe(false)
    }
    expect(await page.evaluate(() => (window as any).session.navigator.current.locationId)).toBe('stop-b')
    expect(await hidden(page, 'a', 2)).toBe(false)
    expect(await hidden(page, 'b', 1)).toBe(true)
    expect(await page.evaluate(() => (window as any).session.readCourseStateSnapshot().answered)).toBe(true)
  } finally { await page.evaluate(() => (window as any).presenter.destroy()); await page.close() }
})

it('cross-surface return resumes the Spatial carrier at a legal arrival and scene navigation skips the remaining stop fragments', async () => {
  const added = addCourseFlowPage(spatialStopsProject(), { title: '总结讲义' })
  if (!added.ok) throw new Error(added.reason)
  const page = await open(added.project)
  try {
    await move(page, 'nextStep'); await move(page, 'nextStep')
    expect(await hidden(page, 'a', 1)).toBe(false)
    expect(await page.evaluate(() => (window as any).session.nextScene())).toBe(true)
    expect(await progress(page)).toMatchObject({ sceneIndex: 1, stepIndex: 0 })
    await move(page, 'previousStep')
    expect(await page.evaluate(() => (window as any).session.navigator.current.locationId)).toBe('stop-a2')
    expect(await hidden(page, 'a', 2)).toBe(false)
    expect(await page.evaluate(() => (window as any).session.nextScene())).toBe(true)
    await page.evaluate(() => (window as any).session.goToLocation('stop-a'))
    expect(await hidden(page, 'a', 1)).toBe(true)
    expect(await page.locator('[data-spatial-world]').getAttribute('transform')).toContain('rotate(-30)')
    await move(page, 'nextStep')
    expect(await hidden(page, 'a', 1)).toBe(false)
    expect(await page.locator('iframe[data-web-composition="a"]').count()).toBe(1)
  } finally { await page.evaluate(() => (window as any).presenter.destroy()); await page.close() }
})

it('the current Spatial try-run controller expands fragments and reports progress without treating stops as scenes', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  try {
    await page.setContent('<div id="host" style="width:1280px;height:720px"></div>')
    await page.addScriptTag({ content: bundle })
    const project = spatialStopsProject(true)
    const controller = project.globalLayerItems.find(entry => entry.item.kind === 'component' && entry.item.role === 'teacher-controller')!.item
    if (controller.kind !== 'component') throw new Error('Expected teacher controller')
    controller.props.defaultCollapsed = false
    await page.evaluate(async project => {
      const api = (window as any).SpatialTest
      const pkg = api.createDefaultTeacherControllerPackage()
      const host = await api.mountSpatialLocationTryRun({ container: document.getElementById('host'), project, locationId: 'stop-a', components: { [pkg.manifest.id]: pkg } })
      Object.assign(window, { tryRun: host })
    }, project)
    expect(await page.locator('[data-spatial-world]').getAttribute('transform')).toContain('rotate(-30)')
    expect(await hidden(page, 'a', 1)).toBe(true)
    expect(await page.locator('[data-controller-button-id="next-scene"]').isDisabled()).toBe(true)
    for (const expected of ['fragment_step_1', 'fragment_step_2', 'fragment_step_0']) {
      await page.locator('[data-controller-button-id="next"]').click()
      await expect.poll(() => page.evaluate(() => (window as any).tryRun.getPublishedPresentationStateId())).toBe(expected)
    }
    expect(await page.evaluate(() => (window as any).tryRun.locationId)).toBe('stop-b')
    expect(await hidden(page, 'a', 2)).toBe(false)
    expect(await hidden(page, 'b', 1)).toBe(true)
    await page.locator('[data-controller-button-id="previous"]').click()
    await expect.poll(() => page.evaluate(() => (window as any).tryRun.getPublishedPresentationStateId())).toBe('fragment_step_2')
    expect(await page.evaluate(() => (window as any).tryRun.locationId)).toBe('stop-a')
  } finally { await page.evaluate(() => (window as any).tryRun?.destroy()); await page.close() }
})

it('editing and static capture show all fragments, while a fresh player begins at the requested stop', async () => {
  const page = await browser.newPage()
  try {
    await page.setContent('<div id="host"></div>')
    await page.addScriptTag({ content: bundle })
    const project = spatialStopsProject()
    const payload = buildPublishedCourseV2Payload({ project, assetFiles: {}, components: {} })
    await page.evaluate(async payload => {
      const api = (window as any).SpatialTest
      const capture = api.createPublishedCourseSession(payload, { staticCapture: true, initialLocationId: 'stop-a' })
      await capture.mount(document.getElementById('host'))
      Object.assign(window, { session: capture })
    }, payload)
    const last = fragment(page, 'a', 2)
    await last.waitFor({ state: 'attached' })
    expect(await last.evaluate(node => getComputedStyle(node).visibility)).toBe('visible')
    await page.evaluate(async payload => {
      await (window as any).session.destroy()
      const api = (window as any).SpatialTest
      const surface = payload.surfaces.find((surface: any) => surface.type === 'spatial-2d') as any
      const handle = api.mountWebComposition(document.getElementById('host'), { instanceId: 'a', content: surface.world.layerItems[0].content, width: 400, height: 300, mode: 'authoring', session: api.createPublishedSurfaceRuntimeSession(), resolveAsset: () => undefined })
      Object.assign(window, { editHandle: handle })
      await handle.ready
    }, payload)
    expect(await fragment(page, 'a', 2).evaluate(node => getComputedStyle(node).visibility)).toBe('visible')
    await page.evaluate(() => (window as any).editHandle.destroy())
    await page.evaluate(async payload => {
      const session = (window as any).SpatialTest.createPublishedCourseSession(payload, { initialLocationId: 'stop-a', initialPresentationStateId: 'fragment_step_1' })
      Object.assign(window, { session }); await session.mount(document.getElementById('host'))
    }, payload)
    await fragment(page, 'a', 2).waitFor({ state: 'attached' })
    expect(await hidden(page, 'a', 1)).toBe(false)
    expect(await hidden(page, 'a', 2)).toBe(true)
    expect(await page.locator('[data-spatial-world]').getAttribute('transform')).toContain('rotate(-30)')
  } finally { await page.evaluate(() => (window as any).session?.destroy()); await page.close() }
})
