// @vitest-environment node
import { build } from 'esbuild'
import { chromium, type Page } from 'playwright'
import { expect, it } from 'vitest'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { buildInputRuleFamily } from '../../src/core/tools/inputRuleFamily'
import { createTextNode, DEFAULT_INPUT_STYLE } from '../../src/core/tools/nativeNodeFactories'
import { buildPublishedCourseV2Payload, publishLayerItem } from '../../src/renderer/export/course/buildPublishedCourse'
import { findCompositionNode } from '../../src/shared/composition/content'
import type { CompositionLayerItem } from '../../src/shared/courseProjectTypes'
import type { NativeInputContent } from '../../src/shared/contracts/native-v1/types'
import type { DocumentModel } from '../../src/shared/workbench/document'

type CourseModel = Extract<DocumentModel, { kind: 'course-v9' }>
type ContentNode = CompositionLayerItem['content']['root']
const element = (id: string, tagName: string, children: ContentNode[], attributes: Record<string, string> = {}): ContentNode =>
  ({ id, kind: 'element', tagName, attributes, children })
const text = (id: string, value: string): ContentNode => ({ id, kind: 'text', text: value })

function fixture(includeUnknown = true): CourseModel {
  const project = createBlankCourseProject({ canvas: { width: 800, height: 500 }, includeDefaultController: false, controls: 'none' })
  project.courseState = [
    { key: 'text-answer', valueType: 'string', defaultValue: '' },
    { key: 'text-valid', valueType: 'boolean', defaultValue: false },
    { key: 'text-feedback', valueType: 'string', defaultValue: '' },
    { key: 'number-answer', valueType: 'number', defaultValue: 0 },
    { key: 'number-valid', valueType: 'boolean', defaultValue: false },
    { key: 'number-feedback', valueType: 'string', defaultValue: '' },
  ]
  const inputs: ContentNode[] = []
  const scene = project.surfaces.find(surface => surface.type === 'slide')!.scenes[0]!
  let identity = 0
  for (const answerType of ['text', 'number'] as const) {
    const data: NativeInputContent = { answerType, stateKey: `${answerType}-answer`, validityKey: `${answerType}-valid`,
      ruleFamilyRuleIds: [], placeholder: answerType === 'text' ? 'Text answer' : 'Numeric answer', style: DEFAULT_INPUT_STYLE }
    const actions = {
      correct: [{ type: 'course-state.set' as const, key: `${answerType}-feedback`, value: '回答正确' }],
      error: [{ type: 'course-state.set' as const, key: `${answerType}-feedback`, value: '请再试一次' }],
    }
    const rules = buildInputRuleFamily(`lesson/${answerType}`, data, answerType === 'text'
      ? { answerType, answers: ['answer'], ...actions } : { answerType, min: 1, max: 2, ...actions }, () => `rule-${++identity}`)
    data.ruleFamilyRuleIds = rules.map(rule => rule.id)
    scene.interactions.push(...rules)
    inputs.push(element(`${answerType}-slot`, 'section', [{ id: answerType, kind: 'native', content: { nativeType: 'input', data } }], { style: 'height:64px' }))
  }
  if (includeUnknown) inputs.push(element('unknown-slot', 'section', [{ id: 'unknown', kind: 'native', content: {
    nativeType: 'input', data: { answerType: 'text', stateKey: 'unconfigured', validityKey: 'unconfigured-valid',
      ruleFamilyRuleIds: [], placeholder: 'Unconfigured', style: DEFAULT_INPUT_STYLE },
  } }], { style: 'height:90px' }))
  const item: CompositionLayerItem = {
    layerItemId: 'lesson', kind: 'composition', label: 'Native inputs', locked: false, order: 0, visible: true,
    rotation: 0, opacity: 1, hitPolicy: 'auto', playbackInitialVisibility: 'inherit',
    frame: { mode: 'absolute', x: 0, y: 0, width: 800, height: 500 },
    content: { doctype: '<!DOCTYPE html>', assets: {}, root: element('html', 'html', [
      element('head', 'head', [element('style', 'style', [text('css', 'html,body{margin:0}main{display:grid;gap:24px;padding:20px}h1{margin:0}')])]),
      element('body', 'body', [element('main', 'main', [element('title', 'h1', [text('title-text', 'Complete the answers')]), ...inputs])]),
    ]) },
  }
  scene.layerItems.push(item)
  return { kind: 'course-v9', project, resources: { assets: {}, components: {} } }
}

function view(model: DocumentModel) {
  if (model.kind !== 'course-v9') throw new Error('Expected Course V9')
  const surface = model.project.surfaces.find(surface => surface.type === 'slide')!, scene = surface.scenes[0]!
  const item = scene.layerItems.find(item => item.layerItemId === 'lesson')!
  const published = publishLayerItem({ project: model.project, assetFiles: model.resources.assets, components: {} }, item)
  if (published.kind !== 'composition') throw new Error('Expected composition')
  return { content: published.content, rules: scene.interactions, declarations: model.project.courseState, sceneId: scene.id }
}

async function readState(page: Page) {
  return page.evaluate(() => (window as any).inputHarness.state.snapshot())
}

it('F06 submits existing Native text and numeric rules, retains draft on reflow, resets and reopens the same rules', async () => {
  const browser = await chromium.launch({ headless: true })
  const bundle = (await build({
    stdin: { contents: `export {mountWebComposition} from './src/player/composition/mountWebComposition';export {createPublishedSurfaceRuntimeSession} from './src/player/surfaces/runtime/publishedSurfaceRuntimeMount';export {CourseStateStore} from './src/player/CourseStateStore';export {PublishedInteractionController} from './src/player/interactions/PublishedInteractionController'`, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'CompositionInput', define: { 'process.env.NODE_ENV': '"test"' },
  })).outputFiles[0]!.text
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } })
    await page.setContent('<div id="host"></div><output id="text-feedback"></output><output id="number-feedback"></output>')
    await page.addScriptTag({ content: bundle })
    const initial = fixture()
    await page.evaluate(async initialView => {
      const api = (window as any).CompositionInput
      const harness: any = { errors: [], atomicWrites: [], view: initialView }
      harness.state = new api.CourseStateStore((change: any) => {
        if (change.type === 'batch') harness.atomicWrites.push(change.entries)
        for (const key of ['text-feedback', 'number-feedback']) document.getElementById(key)!.textContent = harness.state.get(key) ?? ''
      })
      harness.session = api.createPublishedSurfaceRuntimeSession(harness.state)
      harness.mount = async (next: any) => {
        harness.view = next
        harness.state.setMany(next.declarations.map((declaration: any) => ({ key: declaration.key, value: declaration.defaultValue })))
        harness.handle = api.mountWebComposition(document.getElementById('host'), {
          instanceId: 'lesson', content: next.content, width: 800, height: 500, mode: 'playback',
          resolveAsset: () => undefined, session: harness.session, courseState: harness.state,
          describeInput(_id: string, input: any) {
            const value = next.declarations.find((declaration: any) => declaration.key === input.stateKey)
            const validity = next.declarations.find((declaration: any) => declaration.key === input.validityKey)
            if (!value || value.valueType !== (input.answerType === 'text' ? 'string' : 'number') || validity?.valueType !== 'boolean') return null
            return { answerType: input.answerType, stateKey: input.stateKey, validityKey: input.validityKey, defaultValue: value.defaultValue }
          },
        })
        // Bind from formal source identity before the asynchronous iframe loads.
        harness.controller = new api.PublishedInteractionController({ surfaceId: 'slide', rules: next.rules,
          surface: { bindNodeClick: () => null, executeNodeMotion: () => false,
            describeInput: (id: string) => harness.handle.describeInput(id),
            bindInputSubmit: (id: string, listener: any) => harness.handle.bindInputSubmit(id, listener) },
          session: { courseState: harness.state, setCourseStateBatch: (entries: any) => harness.state.setMany(entries), currentSceneId: () => next.sceneId,
            goToScene: () => false, nextScene: () => false, previousScene: () => false, replayScene: () => false, restartCourse: () => false },
          reportDiagnostic: (diagnostic: any) => harness.errors.push(diagnostic),
        })
        await harness.handle.ready
      }
      harness.reset = async (next = harness.view) => {
        harness.controller.destroy(); harness.handle.destroy(); harness.session.resetCourse()
        await harness.mount(next)
      }
      Object.assign(window, { inputHarness: harness })
      await harness.mount(initialView)
    }, view(initial))
    const frame = page.frameLocator('iframe[data-web-composition]')
    const textInput = frame.getByRole('textbox', { name: 'Text answer' })
    const submit = frame.locator('[data-composition-node="text"]').getByRole('button', { name: '提交' })
    await textInput.fill('wrong')
    await submit.click()
    await expect.poll(() => page.locator('#text-feedback').textContent()).toBe('请再试一次')
    expect(await readState(page)).toMatchObject({ 'text-answer': 'wrong', 'text-valid': true })
    await textInput.fill(' ＡＮＳＷＥＲ  ')
    await textInput.press('Enter')
    await expect.poll(() => page.locator('#text-feedback').textContent()).toBe('回答正确')
    expect(await readState(page)).toMatchObject({ 'text-answer': 'answer', 'text-valid': true })
    await textInput.fill('draft before resize')
    const retained = await page.evaluate(async () => {
      const h = (window as any).inputHarness, before = h.handle.element.contentDocument.querySelector('input')
      h.handle.resize(420, 700); await h.handle.waitForReady()
      const next = structuredClone(h.view.content)
      const find = (node: any, id: string): any => node.id === id ? node : node.children?.map((child: any) => find(child, id)).find(Boolean)
      find(next.root, 'title-text').text = 'A longer edited heading'
      await h.handle.update(next)
      const after = h.handle.element.contentDocument.querySelector('input')
      return { same: before === after, value: after.value, focused: h.handle.element.contentDocument.activeElement === after }
    })
    expect(retained).toEqual({ same: true, value: 'draft before resize', focused: true })
    await textInput.press('Escape')
    expect(await textInput.inputValue()).toBe(' ＡＮＳＷＥＲ  ')
    const numberInput = frame.getByRole('textbox', { name: 'Numeric answer' })
    await numberInput.fill('0x10')
    await numberInput.press('Enter')
    await expect.poll(() => page.locator('#number-feedback').textContent()).toBe('请再试一次')
    expect(await readState(page)).toMatchObject({ 'number-answer': 0, 'number-valid': false })
    await numberInput.fill('１.５')
    await numberInput.press('Enter')
    await expect.poll(() => page.locator('#number-feedback').textContent()).toBe('回答正确')
    expect(await readState(page)).toMatchObject({ 'number-answer': 1.5, 'number-valid': true })
    expect(await frame.locator('[data-composition-node="unknown"]').getByRole('button', { name: '提交' }).isDisabled()).toBe(true)
    expect(await frame.locator('[data-composition-node="unknown"]').textContent()).toContain('未配置有效')
    expect(await page.evaluate(() => (window as any).inputHarness.errors)).toEqual([])
    const writes = await page.evaluate(() => (window as any).inputHarness.atomicWrites)
    expect(writes.slice(1)).toHaveLength(4)
    expect(writes.slice(1).every((entries: any[]) => entries.length === 2)).toBe(true)
    await page.evaluate(async () => (window as any).inputHarness.reset())
    expect(await textInput.inputValue()).toBe('')
    expect(await numberInput.inputValue()).toBe('')
    expect(await readState(page)).toMatchObject({ 'text-valid': false, 'text-feedback': '', 'number-valid': false, 'number-feedback': '' })

    // The intentionally unconfigured display-only input has no answer contract.
    // Remove it for the strict existing saved-rule fixture.
    const body = findCompositionNode((initial.project.surfaces.find(surface => surface.type === 'slide')!.scenes[0]!.layerItems[0] as CompositionLayerItem).content.root, 'main')!
    if (body.kind !== 'element') throw new Error('Expected main')
    body.children = body.children.filter(node => node.id !== 'unknown-slot')
    const driver = new CourseV9Driver()
    const reopened = driver.load(driver.serialize(initial))
    expect(view(reopened).rules).toEqual(view(initial).rules)
    expect(view(reopened).declarations).toEqual(view(initial).declarations)
    await page.evaluate(async next => (window as any).inputHarness.reset(next), view(reopened))
    await textInput.fill('answer')
    await textInput.press('Enter')
    await expect.poll(() => page.locator('#text-feedback').textContent()).toBe('回答正确')
    await page.close()
  } finally { await browser.close() }
}, 40_000)

it('F06 runs saved composition input through the real Published Slide port with visible feedback and course reset', async () => {
  const model = fixture(false), scene = model.project.surfaces.find(surface => surface.type === 'slide')!.scenes[0]!
  for (const [index, outcome] of ['correct', 'error'].entries()) {
    const node = createTextNode({ text: outcome === 'correct' ? '回答正确' : '请再试一次', width: 500, height: 70 })
    scene.layerItems.push({
      layerItemId: `feedback-${outcome}`, kind: 'native', label: `反馈 ${outcome}`, locked: false, visible: true,
      order: index + 1, rotation: 0, opacity: 1, hitPolicy: 'auto', playbackInitialVisibility: 'hidden',
      frame: { mode: 'absolute', x: 20, y: 380, width: 500, height: 70 },
      content: { nativeType: 'text', data: { text: node.text, runs: node.runs, style: node.style } },
    })
  }
  scene.interactions.forEach((rule, index) => {
    const feedback = rule.actions[0]!.action
    const correct = feedback.type === 'course-state.set' && feedback.value === '回答正确'
    rule.actions.push(
      { id: `feedback-show-${index}`, start: 'after-previous', delayMs: 0, action: { type: 'node.enter', nodeId: correct ? 'feedback-correct' : 'feedback-error', effect: 'none', durationMs: 0, easing: 'linear' } },
      { id: `feedback-hide-${index}`, start: 'after-previous', delayMs: 0, action: { type: 'node.exit', nodeId: correct ? 'feedback-error' : 'feedback-correct', effect: 'none', durationMs: 0, easing: 'linear' } },
    )
  })
  const driver = new CourseV9Driver(), reopened = driver.load(driver.serialize(model))
  if (reopened.kind !== 'course-v9') throw new Error('Expected saved Course V9')
  const payload = buildPublishedCourseV2Payload({ project: reopened.project, assetFiles: {}, components: {} })
  const bundle = (await build({
    stdin: { contents: `export {createPublishedCourseSession} from './src/player/surfaces/publishedDynamicHosts';export {SlidePublishedAdapter} from './src/player/surfaces/slide/SlidePublishedAdapter';export {waitForPublishedObservationReady} from './src/player/surfaces/publishedCapture'`, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'ActualInputPlayer',
    loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl' },
    define: { 'process.env.NODE_ENV': '"test"' },
  })).outputFiles[0]!.text
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
    await page.setContent('<div id="host" style="position:relative;width:800px;height:500px"></div>')
    await page.addScriptTag({ content: bundle })
    await page.evaluate(async payload => {
      const api = (window as any).ActualInputPlayer, diagnostics: any[] = []
      const session = api.createPublishedCourseSession(payload, { services: { reportDiagnostic: (value: any) => diagnostics.push(value) } })
      Object.assign(window, { actualInputSession: session, inputDiagnostics: diagnostics })
      await session.mount(document.getElementById('host'))
      await api.waitForPublishedObservationReady(document.getElementById('host'))
    }, payload)
    const input = page.frameLocator('iframe[data-web-composition]').getByRole('textbox', { name: 'Text answer' })
    const correct = page.locator('[data-slide-layer-item="feedback-correct"]')
    const error = page.locator('[data-slide-layer-item="feedback-error"]')
    expect(await correct.isVisible()).toBe(false)
    expect(await error.isVisible()).toBe(false)
    await input.fill('wrong')
    await input.press('Enter')
    await expect.poll(() => error.isVisible()).toBe(true)
    expect(await correct.isVisible()).toBe(false)
    await input.fill('ＡＮＳＷＥＲ')
    await input.press('Enter')
    await expect.poll(() => correct.isVisible()).toBe(true)
    expect(await error.isVisible()).toBe(false)
    expect(await page.evaluate(() => (window as any).actualInputSession.readCourseStateSnapshot())).toMatchObject({
      'text-answer': 'answer', 'text-valid': true, 'text-feedback': '回答正确',
    })
    await page.evaluate(async () => {
      const w = window as any
      if (!await w.actualInputSession.restartCourse()) throw new Error('Course reset rejected')
      await w.ActualInputPlayer.waitForPublishedObservationReady(document.getElementById('host'))
    })
    expect(await input.inputValue()).toBe('')
    expect(await correct.isVisible()).toBe(false)
    expect(await error.isVisible()).toBe(false)
    expect(await page.evaluate(() => (window as any).actualInputSession.readCourseStateSnapshot())).toMatchObject({ 'text-answer': '', 'text-valid': false, 'text-feedback': '' })
    expect(await page.evaluate(() => (window as any).inputDiagnostics)).toEqual([])
    await page.evaluate(async () => (window as any).actualInputSession.destroy())
    const lifecycle = await page.evaluate(async payload => {
      const api = (window as any).ActualInputPlayer, host = document.getElementById('host')!, events: any[] = []
      let composition: any
      const adapter = new api.SlidePublishedAdapter(payload, payload.surfaces[0]!.id, {
        authoring: { scope: 'scene', stateId: null, onCompositionMount(id: string, handle: any) {
          events.push({ id, mounted: !!handle })
          if (handle) composition = handle
        } },
      })
      await adapter.mount({ container: host, services: {}, signal: new AbortController().signal })
      await composition.ready
      const same = composition.element === host.querySelector('iframe[data-web-composition]')
      const count = host.querySelectorAll('iframe[data-web-composition]').length
      await adapter.destroy(); await adapter.destroy()
      return { same, count, events, remaining: host.querySelectorAll('iframe[data-web-composition]').length }
    }, payload)
    expect(lifecycle).toEqual({ same: true, count: 1, events: [{ id: 'lesson', mounted: true }, { id: 'lesson', mounted: false }], remaining: 0 })
    await page.close()
  } finally { await browser.close() }
}, 40_000)
