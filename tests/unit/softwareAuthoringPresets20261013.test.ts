// @vitest-environment node
import { compileFunction, constants } from 'node:vm'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fireEvent } from '@testing-library/dom'
import userEvent from '@testing-library/user-event'
import { JSDOM } from 'jsdom'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { planCourseRecipeEdits, recipeDefaults, type RecipeId } from '../../src/core/course/courseRecipeEdits'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { componentCompilationInput } from '../../src/core/components/compilation/componentCompilationInput'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import { ComponentNavigationOwner } from '../../src/renderer/components/ComponentNavigationOwner'
import { mountV10Model, type ComponentPlayerModel } from '../../src/player/componentPlatform/ModelPlayer'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'
import { componentAssetIds, sourceResourceReferences } from '../../src/core/components/library/references'
import { teacherControllerReferenceSize } from '../../src/shared/teacherControllerViewportGeometry'
import { isComponentVisibleAtSurface, type ComponentImplementation, type JsonValue } from '../../src/shared/contracts/component-platform/project'
import type { ComponentRuntimeContext, ComponentRuntimeImplementation } from '../../src/shared/contracts/component-platform/runtime'
import type { ComponentEdit } from '../../src/shared/contracts/component-platform/operations'
import { createCourseDocumentHost } from '../helpers/courseDocumentHost'

// The source compiler is a Node consumer. Keep Node binary constructors and supply only the real DOM realm.
const realm = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'https://presets.example/' })
beforeAll(() => {
  for (const name of ['window', 'document', 'Element', 'HTMLElement', 'SVGElement', 'Node', 'Event', 'CustomEvent', 'DOMException', 'DOMParser'] as const)
    vi.stubGlobal(name, name === 'window' ? realm.window : name === 'document' ? realm.window.document : realm.window[name])
  vi.stubGlobal('getComputedStyle', realm.window.getComputedStyle.bind(realm.window))
  vi.stubGlobal('requestAnimationFrame', realm.window.requestAnimationFrame.bind(realm.window))
  vi.stubGlobal('cancelAnimationFrame', realm.window.cancelAnimationFrame.bind(realm.window))
})
afterAll(() => { realm.window.close(); vi.unstubAllGlobals() })

/** Real recipe -> one canonical operation -> production archive/World; only file I/O is in memory. */
async function authoredFixture() {
  const project = createBlankCourseProjectV10('首批机制验证')
  const origin = project.surfaces[0]
  origin.title = '人工首页'
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  project.instances.human = { id: 'human', definitionId: TEXT_DEFINITION.id, name: '人工保留文字',
    data: JSON.parse(JSON.stringify(createTextComponentData('保留人工内容'))),
    frame: { width: 240, height: 70, transform: [1, .1, .2, 1, 163, 421] } }
  origin.childIds = ['human']
  const host = await createCourseDocumentHost()
  const initial = await host.api.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'presets.glx')
  let operation = 0
  const read = (): ComponentPlayerModel => {
    const model = host.registry.get(initial.documentId).read().model
    if (model.kind !== 'course-v10') throw new Error('Expected V10')
    return model
  }
  const edit = async (edits: ComponentEdit[]) => {
    const snapshot = host.registry.get(initial.documentId).read()
    if (snapshot.model.kind !== 'course-v10') throw new Error('Expected V10')
    const result = await host.api.dispatch({ documentId: initial.documentId, epoch: initial.epoch,
      operationId: `preset-operation-${++operation}`, baseRevision: snapshot.revision, actor: 'human',
      mutation: { type: 'command', command: captureComponentOperation(snapshot.model.project, edits) } })
    expect(result.status).toBe('applied')
    expect(host.registry.get(initial.documentId).read().undoDepth).toBe(operation)
    return read()
  }
  const add = async (recipeId: RecipeId, slots: Record<string, string> = {}, surfaceId = origin.id) => {
    const before = read()
    const plan = planCourseRecipeEdits(before.project, { recipeId, surfaceId, slots: { ...recipeDefaults(recipeId), ...slots } })
    if (!plan.ok) throw new Error(plan.reason)
    const model = await edit(plan.edits)
    const sourceIds = Object.keys(model.project.instances).filter(id => !before.project.instances[id]
      && model.project.definitions[model.project.instances[id].definitionId].implementation.kind === 'source')
    expect(sourceIds).toHaveLength(1)
    return { instanceId: sourceIds[0], surfaceId: plan.createdLocationId, model }
  }
  const saveAndReopen = async (path: string) => {
    const saved = await host.api.save(initial.documentId, path)
    expect(saved.dirty).toBe(false)
    expect(host.durable.get(initial.documentId)?.savedRevision).toBe(saved.revision)
    const bytes = host.disk.get(path)!
    expect(bytes.byteLength).toBeGreaterThan(0)
    const authored = saved.model
    await host.restart()
    const reopened = await host.api.open(path)
    expect(reopened.model).toEqual(authored)
    expect(reopened.undoDepth).toBe(0)
    if (reopened.model.kind !== 'course-v10') throw new Error('Expected V10')
    return { model: reopened.model, bytes }
  }
  return { host, initial, project, originId: origin.id, read, edit, add, saveAndReopen }
}

async function liveWorld(initialModel: ComponentPlayerModel, surfaceId: string) {
  let model = initialModel, currentSurface = surfaceId
  const root = document.createElement('div')
  document.body.append(root)
  const compiler = createEsbuildComponentCompiler(), diagnostics: string[] = []
  const scopes = new Map<string, ComponentRuntimeContext>()
  const navigation = new ComponentNavigationOwner({ project: () => model.project, surfaceId: () => currentSurface,
    select: id => { currentSurface = id } })
  const prepare = async (implementation: Extract<ComponentImplementation, { kind: 'source' }>) => {
    const compiled = await compiler.compile(componentCompilationInput(model.project, implementation, model.resources))
    if (compiled.status !== 'ready') throw new Error(JSON.stringify(compiled.diagnostics))
    const load = compileFunction('return import(url)', ['url'], { importModuleDynamically: constants.USE_MAIN_CONTEXT_DEFAULT_LOADER })
    const loaded = await load('data:text/javascript;base64,' + Buffer.from(compiled.artifact.code).toString('base64')) as { default: ComponentRuntimeImplementation }
    return { implementation: { mount(context: ComponentRuntimeContext) {
      scopes.set(context.instance.id, context)
      return loaded.default.mount(context)
    } } }
  }
  const player = mountV10Model({ root, model, runScopeId: 'preset-check', initialSurfaceId: surfaceId,
    teacherController: navigation, resolveSource: prepare, report: message => diagnostics.push(message) })
  await player.ready
  expect(diagnostics).toEqual([])
  const content = (instanceId: string) => {
    const element = player.runtime.contentElement(instanceId)
    if (!element) throw new Error('Missing mounted content: ' + instanceId)
    return element
  }
  return { root, player, scopes, navigation, diagnostics, content,
    async update(next: ComponentPlayerModel) { model = next; await player.update(next) },
    async go(surface: string) { expect(await navigation.execute({ type: 'scene.go', sceneId: surface })).toBe(true); player.revealSurface(surface); await player.ready },
    async dispose() { navigation.cancel(); await player.dispose(); root.remove() } }
}

function button(root: HTMLElement, text: string): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find(value => value.textContent === text)
  if (!found) throw new Error('Missing actual button: ' + text)
  return found
}

/** JSDOM lacks DataTransfer; dispatch the browser's actual event contract to installed listeners. */
function drop(root: HTMLElement, source: string, target: string) {
  const dragged = [...root.querySelectorAll<HTMLElement>('[data-drag-item]')].find(element => element.dataset.dragItem === source)!
  const destination = [...root.querySelectorAll<HTMLElement>('[data-drop-target]')].find(element => element.dataset.dropTarget === target)!
  expect(dragged).toBeTruthy(); expect(destination).toBeTruthy()
  const payload = new Map<string, string>()
  const dataTransfer = { effectAllowed: '', dropEffect: '', types: ['text/plain'],
    setData: (key: string, value: string) => { payload.set(key, value) }, getData: (key: string) => payload.get(key) ?? '' }
  for (const [element, type] of [[dragged, 'dragstart'], [destination, 'dragover'], [destination, 'drop']] as const) {
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
    element.dispatchEvent(event)
    if (type === 'dragover') expect(event.defaultPrevented).toBe(true)
  }
}

it('reveals the configured sequence, emits real progress, and restores the authored initial step after reset and re-entry', async () => {
  const fixture = await authoredFixture()
  const authored = await fixture.add('step-reveal-v1', { initialStep: '1', steps: '观察现象\n比较变化\n解释原因' })
  const snapshot = fixture.host.registry.get(fixture.initial.documentId).read()
  const world = await liveWorld(authored.model, authored.surfaceId), root = world.content(authored.instanceId)
  const events: JsonValue[] = [], off = world.scopes.get(authored.instanceId)!.scope.events.subscribe('reveal.change', value => events.push(value))
  const count = () => root.querySelectorAll('.teaching-interaction p').length, user = userEvent.setup({ document })
  try {
    expect(count()).toBe(1)
    await user.click(button(root, '下一步 →')); await user.click(button(root, '下一步 →'))
    expect(count()).toBe(3)
    expect(button(root, '下一步 →')).toBeDisabled()
    expect(events.at(-1)).toEqual({ step: 3, total: 3, progress: 1 })
    expect(world.player.runtime.getState(`component:${authored.instanceId}:progress`)).toBe(3)
    await user.click(button(root, '重置'))
    expect(count()).toBe(1)
    await user.click(button(root, '下一步 →'))
    await world.go(fixture.originId)
    world.player.runtime.bind(authored.instanceId, null)
    await world.player.runtime.sync(authored.model.project, authored.model.resources)
    await world.go(authored.surfaceId)
    world.player.runtime.bind(authored.instanceId, root)
    await world.player.runtime.sync(authored.model.project, authored.model.resources)
    expect(count()).toBe(1)
    expect(world.player.runtime.getState(`component:${authored.instanceId}:progress`)).toBe(1)
    expect(fixture.host.registry.get(fixture.initial.documentId).read()).toEqual(snapshot)
    expect(world.diagnostics).toEqual([])
  } finally { off(); await world.dispose(); fixture.host.dispose() }
})

it('submits an exact multiselection, reports content feedback, and resets selected state without author writes', async () => {
  const fixture = await authoredFixture()
  const authored = await fixture.add('choice-feedback-v1', { selectionMode: 'multiple', options: '2\n3\n4', correct: '1,3', success: '2 和 4 都是偶数', failure: '检查每个所选数字' })
  const before = fixture.host.registry.get(fixture.initial.documentId).read()
  const world = await liveWorld(authored.model, authored.surfaceId), root = world.content(authored.instanceId)
  const answers: JsonValue[] = [], user = userEvent.setup({ document })
  const off = world.scopes.get(authored.instanceId)!.scope.events.subscribe('answer', value => answers.push(value))
  try {
    await user.click(button(root, 'A. 2')); await user.click(button(root, 'B. 3')); await user.click(button(root, '提交选择'))
    expect(root.querySelector('[role=status]')).toHaveTextContent('检查每个所选数字')
    expect(answers.at(-1)).toEqual({ correct: false, progress: 0 })
    await user.click(button(root, 'B. 3')); await user.click(button(root, 'C. 4')); await user.click(button(root, '提交选择'))
    expect(root.querySelector('[role=status]')).toHaveTextContent('2 和 4 都是偶数')
    expect(answers.at(-1)).toEqual({ correct: true, progress: 1 })
    expect(world.player.runtime.getState(`component:${authored.instanceId}:progress`)).toBe(1)
    await user.click(button(root, '重置'))
    expect(root.querySelectorAll('[aria-pressed=true]')).toHaveLength(0)
    expect(button(root, '提交选择')).toBeDisabled()
    expect(world.player.runtime.getState(`component:${authored.instanceId}:progress`)).toBe(0)
    expect(fixture.host.registry.get(fixture.initial.documentId).read()).toEqual(before)
    expect(world.diagnostics).toEqual([])
  } finally { off(); await world.dispose(); fixture.host.dispose() }
})

it('uses actual drop listeners for matching and sorting, reports the resulting answer, and restores the initial order', async () => {
  const fixture = await authoredFixture()
  const matched = await fixture.add('classify-sort-v1', { mode: 'match', items: '叶子 | 植物\n小鸟 | 动物', groups: '植物\n动物', success: '匹配正确' })
  const sorted = await fixture.add('classify-sort-v1', { mode: 'sort', items: '观察\n解释\n比较', correctOrder: '比较,观察,解释', success: '排序正确' })
  const world = await liveWorld(sorted.model, matched.surfaceId), user = userEvent.setup({ document })
  try {
    const matchRoot = world.content(matched.instanceId), items = (sorted.model.project.instances[matched.instanceId].data as { items: { id: string; group: string }[] }).items
    for (const item of items) drop(matchRoot, item.id, item.group)
    await user.click(button(matchRoot, '检查答案'))
    expect(matchRoot.querySelector('[role=status]')).toHaveTextContent('匹配正确')
    expect(matchRoot.querySelector('[data-drop-target="植物"]')).toHaveTextContent('叶子')
    await user.click(button(matchRoot, '重置'))
    expect(matchRoot.querySelector('[data-drop-target="植物"]')).toHaveTextContent('放到这里')
    await world.go(sorted.surfaceId)
    const sortRoot = world.content(sorted.instanceId), order = (sorted.model.project.instances[sorted.instanceId].data as { items: { id: string }[] }).items
    drop(sortRoot, order[2].id, order[0].id)
    expect([...sortRoot.querySelectorAll('.row .label')].map(element => element.textContent)).toEqual(['1. 比较', '2. 观察', '3. 解释'])
    await user.click(button(sortRoot, '检查答案'))
    expect(sortRoot.querySelector('[role=status]')).toHaveTextContent('排序正确')
    await user.click(button(sortRoot, '重置'))
    expect([...sortRoot.querySelectorAll('.row .label')].map(element => element.textContent)).toEqual(['1. 观察', '2. 解释', '3. 比较'])
    expect(world.diagnostics).toEqual([])
  } finally { await world.dispose(); fixture.host.dispose() }
})

it('connects continuous input to numeric/graphic/state/event results and consumes a canonical deep edit after archive reopen', async () => {
  const fixture = await authoredFixture()
  const authored = await fixture.add('continuous-variable-v1', { stateKey: '长度:值' })
  const human = structuredClone(authored.model.project.instances.human), frame = structuredClone(authored.model.project.instances[authored.instanceId].frame)
  const world = await liveWorld(authored.model, authored.surfaceId), root = world.content(authored.instanceId)
  const events: JsonValue[] = [], off = world.scopes.get(authored.instanceId)!.scope.events.subscribe('variable.change', value => events.push(value))
  let offReturned = () => {}
  try {
    const input = root.querySelector<HTMLInputElement>('input[aria-label="长度"]')!, shape = root.querySelector<SVGElement>('[data-variable-shape]')!
    const initialWidth = Number(shape.getAttribute('width'))
    fireEvent.input(input, { target: { value: '6' } })
    expect(root.querySelector('[data-variable-value]')).toHaveTextContent('6 cm')
    expect(root.querySelector('[data-variable-result]')).toHaveTextContent('18 cm²')
    expect(Number(shape.getAttribute('width'))).toBeGreaterThan(initialWidth)
    expect(Number(shape.getAttribute('width')) / initialWidth).toBeCloseTo(6 / 4)
    expect(Number(shape.getAttribute('width')) / Number(shape.getAttribute('height'))).toBeCloseTo(6 / 3)
    expect(world.player.runtime.getState('长度:值')).toBe(6)
    expect(events.at(-1)).toMatchObject({ value: 6, result: 18, progress: 5 / 7, stateKey: '长度:值' })
    await world.go(fixture.originId)
    world.player.runtime.bind(authored.instanceId, null)
    await world.player.runtime.sync(authored.model.project, authored.model.resources)
    await world.go(authored.surfaceId)
    world.player.runtime.bind(authored.instanceId, root)
    await world.player.runtime.sync(authored.model.project, authored.model.resources)
    expect(root.querySelector<HTMLInputElement>('input[aria-label="长度"]')?.value).toBe('6')
    expect(world.player.runtime.getState('长度:值')).toBe(6)
    expect(fixture.read().project.instances[authored.instanceId].data).toMatchObject({ value: 4 })
    offReturned = world.scopes.get(authored.instanceId)!.scope.events.subscribe('variable.change', event => events.push(event))
    await userEvent.setup({ document }).click(button(root, '重置'))
    expect(root.querySelector<HTMLInputElement>('input[aria-label="长度"]')?.value).toBe('4')
    expect(world.player.runtime.getState('长度:值')).toBe(4)
    expect(events.at(-1)).toEqual({ value: 4, result: 12, progress: 3 / 7, stateKey: '长度:值' })
    world.player.runtime.setState('长度:值', 2)
    expect(root.querySelector<HTMLInputElement>('input[aria-label="长度"]')?.value).toBe('2')
    expect(root.querySelector('[data-variable-result]')).toHaveTextContent('6 cm²')
    const newMultiplier = await fixture.edit([{ type: 'data.set', instanceId: authored.instanceId, path: ['multiplier'], value: 5 }])
    await world.update(newMultiplier)
    expect(root.querySelector('[data-variable-value]')).toHaveTextContent('2 cm')
    expect(root.querySelector('[data-variable-result]')).toHaveTextContent('10 cm²')
    const changedShape = root.querySelector<SVGElement>('[data-variable-shape]')!
    expect(Number(changedShape.getAttribute('width')) / Number(changedShape.getAttribute('height'))).toBeCloseTo(2 / 5)
    expect(world.player.runtime.getState('长度:值')).toBe(2)
    expect(newMultiplier.project.instances[authored.instanceId].data).toMatchObject({ value: 4 })
    const next = await fixture.edit([{ type: 'data.set', instanceId: authored.instanceId, path: ['value'], value: 7 }])
    await world.update(next)
    expect(world.content(authored.instanceId)).toBe(root)
    expect(root.querySelector('[data-variable-value]')).toHaveTextContent('7 cm')
    expect(root.querySelector('[data-variable-result]')).toHaveTextContent('35 cm²')
    expect(next.project.instances.human).toEqual(human)
    expect(next.project.instances[authored.instanceId].frame).toEqual(frame)
    const reopened = await fixture.saveAndReopen('saved-presets.glx')
    expect(reopened.model.project.instances[authored.instanceId].data).toMatchObject({ multiplier: 5, value: 7 })
    expect(reopened.model.project.instances.human).toEqual(human)
    const cold = await liveWorld(reopened.model, authored.surfaceId)
    try { expect(cold.content(authored.instanceId).querySelector('[data-variable-result]')).toHaveTextContent('35 cm²'); expect(cold.diagnostics).toEqual([]) }
    finally { await cold.dispose() }
    expect(world.diagnostics).toEqual([])
  } finally { off(); offReturned(); await world.dispose(); fixture.host.dispose() }
})

it('inserts one shared underlay with current/excluded visibility and preserves all foreground/manual data through saved reopen', async () => {
  const fixture = await authoredFixture()
  const reveal = await fixture.add('step-reveal-v1', { title: '揭示场景' })
  const choice = await fixture.add('choice-feedback-v1', { selectionMode: 'multiple', correct: '1,3', title: '选择反馈' })
  const match = await fixture.add('classify-sort-v1', { mode: 'match', title: '拖拽匹配' })
  const sort = await fixture.add('classify-sort-v1', { mode: 'sort', title: '拖拽排序' })
  const variable = await fixture.add('continuous-variable-v1', { title: '变量关系' })
  const foreground = structuredClone(fixture.read().project.instances), surfaces = structuredClone(fixture.read().project.surfaces)
  const fixed = await fixture.add('static-background-v1', { pattern: 'grid' })
  const moving = await fixture.add('dynamic-background-v1', { scope: 'exclude', pages: '选择反馈', eventName: 'variable.change' })
  const project = moving.model.project
  expect(project.surfaces).toEqual(surfaces)
  for (const [id, instance] of Object.entries(foreground)) expect(project.instances[id]).toEqual(instance)
  expect(project.global.underlay).toEqual([fixed.instanceId, moving.instanceId])
  expect(project.instances[fixed.instanceId]).toMatchObject({ visibility: { mode: 'include', surfaceIds: [fixture.originId] }, viewportPinned: true, style: { pointerEvents: 'none' } })
  expect(project.instances[moving.instanceId]).toMatchObject({ visibility: { mode: 'exclude', surfaceIds: [choice.surfaceId] } })
  expect(isComponentVisibleAtSurface(project.instances[fixed.instanceId], reveal.surfaceId)).toBe(false)
  expect(isComponentVisibleAtSurface(project.instances[moving.instanceId], choice.surfaceId)).toBe(false)
  expect(isComponentVisibleAtSurface(project.instances[moving.instanceId], match.surfaceId)).toBe(true)
  const saved = await fixture.saveAndReopen('first-batch-presets.glx')
  expect(saved.model.project.global).toEqual(project.global)
  const checks = resolve('output/repair-presets/checks')
  await mkdir(checks, { recursive: true })
  await writeFile(resolve(checks, 'presets.glx'), saved.bytes)
  await writeFile(resolve(checks, 'fixture.json'), JSON.stringify({ path: 'presets.glx', originId: fixture.originId,
    reveal, choice, match, sort, variable, staticBackground: fixed.instanceId, dynamicBackground: moving.instanceId },
  (key, value) => key === 'model' ? undefined : value, 2))
  fixture.host.dispose()
})

it('keeps decorative backgrounds outside foreground input and responds to shared state/events with pause and disposal', async () => {
  const fixture = await authoredFixture()
  const choice = await fixture.add('choice-feedback-v1', { title: '排除页面' })
  const authored = await fixture.add('dynamic-background-v1', { scope: 'exclude', pages: '排除页面', stateKey: '背景:强度', eventName: '演示:进度' })
  const world = await liveWorld(authored.model, fixture.originId), root = world.content(authored.instanceId)
  const context = world.scopes.get(authored.instanceId)!, background = root.querySelector<HTMLElement>('.recipe-background')!
  const initialPointerEvents = world.player.runtime.targetElement(authored.instanceId)?.style.pointerEvents
  try {
    expect(world.player.runtime.targetElement('human')?.style.pointerEvents).toBe('auto')
    expect(root.querySelectorAll('button,input')).toHaveLength(0)
    expect(background.style.animationPlayState).toBe('running')
    world.player.runtime.setState('背景:强度', .8)
    expect(background.dataset.backgroundIntensity).toBe('0.8')
    context.scope.events.emit('演示:进度', { progress: .4 })
    expect(background.dataset.backgroundIntensity).toBe('0.4')
    world.player.runtime.setPlaying(false)
    expect(background.style.animationPlayState).toBe('paused')
    world.player.runtime.setPlaying(true)
    expect(background.style.animationPlayState).toBe('running')
    await world.go(choice.surfaceId)
    expect(world.player.runtime.targetElement(authored.instanceId)?.hidden).toBe(true)
    await world.go(fixture.originId)
    expect(world.player.runtime.targetElement(authored.instanceId)?.hidden).toBe(false)
    const recolored = await fixture.edit([{ type: 'data.set', instanceId: authored.instanceId, path: ['colorStart'], value: '#112233' }])
    await world.update(recolored)
    const updatedPointerEvents = world.player.runtime.targetElement(authored.instanceId)?.style.pointerEvents
    expect(root.querySelector<HTMLElement>('.recipe-background')?.style.backgroundImage).toMatch(/#112233|rgb\(17, 34, 51\)/)
    await world.dispose()
    context.scope.events.emit('演示:进度', { progress: 1 })
    context.scope.state.set('背景:强度', 1)
    expect(root.childNodes).toHaveLength(0)
    expect(world.diagnostics).toEqual([])
    expect(initialPointerEvents).toBe('none')
    expect(updatedPointerEvents).toBe('none')
  } finally { await world.dispose(); fixture.host.dispose() }
})

it('keeps nonimage presets resource-free and saves a background image as an editable owned child with its exact asset reference', async () => {
  const fixture = await authoredFixture()
  const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64'))
  const localDesignSize = { width: 960, height: 540 }
  await fixture.edit([{ type: 'surface.designSize.set', surfaceId: fixture.originId, designSize: localDesignSize },
    { type: 'asset.add', asset: { id: 'image-used', path: 'assets/used.png', filename: 'used.png', mimeType: 'image/png' }, bytes: png },
    { type: 'asset.add', asset: { id: 'image-unrelated', path: 'assets/unrelated.png', filename: 'unrelated.png', mimeType: 'image/png' }, bytes: png }])
  const choice = await fixture.add('choice-feedback-v1')
  const variable = await fixture.add('continuous-variable-v1')
  for (const preset of [choice, variable]) {
    const instance = preset.model.project.instances[preset.instanceId], definition = preset.model.project.definitions[instance.definitionId]
    expect(sourceResourceReferences(definition.implementation, preset.model.project, preset.model.resources)).toEqual({ assetIds: [], dynamic: false })
    expect(componentAssetIds(instance, definition, preset.model.project, preset.model.resources)).toEqual([])
  }
  const background = await fixture.add('static-background-v1', { assetId: 'used.png', title: '真实背景图' })
  const parent = background.model.project.instances[background.instanceId]
  const referenceSize = teacherControllerReferenceSize(background.model.project)
  expect(referenceSize).not.toEqual(localDesignSize)
  expect(background.model.project.surfaces.find(surface => surface.id === fixture.originId)?.designSize).toEqual(localDesignSize)
  expect(parent.frame).toEqual({ ...referenceSize, transform: [1, 0, 0, 1, 0, 0] })
  expect(parent.data).not.toHaveProperty('assetId')
  expect(parent.childIds).toHaveLength(1)
  const image = background.model.project.instances[parent.childIds![0]], definition = background.model.project.definitions[image.definitionId]
  expect(image.frame).toEqual({ ...referenceSize, transform: [1, 0, 0, 1, 0, 0] })
  expect(definition.implementation).toMatchObject({ kind: 'builtin', key: 'guoling.image' })
  expect(image.data).toMatchObject({ assetId: 'image-used', originalAssetId: 'image-used', fit: 'cover' })
  expect(componentAssetIds(image, definition, background.model.project, background.model.resources)).toEqual(['image-used'])
  expect(sourceResourceReferences(background.model.project.definitions[parent.definitionId].implementation,
    background.model.project, background.model.resources)).toEqual({ assetIds: [], dynamic: false })
  const saved = await fixture.saveAndReopen('presets-image.glx')
  expect(saved.model.project.instances[background.instanceId].childIds).toEqual([image.id])
  expect(saved.model.project.instances[background.instanceId].frame).toEqual(parent.frame)
  expect(saved.model.project.instances[image.id].frame).toEqual(image.frame)
  expect(saved.model.project.instances[image.id].data).toEqual(image.data)
  expect(Object.keys(saved.model.project.assets).sort()).toEqual(['image-unrelated', 'image-used'])
  const world = await liveWorld(saved.model, fixture.originId)
  try {
    const rendered = world.content(image.id).querySelector<HTMLImageElement>('img')!
    expect(rendered).toBeTruthy()
    expect(rendered.alt).toBe('真实背景图')
    expect(rendered.getAttribute('src')).toBe(world.player.runtime.assetUrl('image-used'))
    expect(rendered.getAttribute('src')).toBeTruthy()
    expect(world.player.runtime.targetElement(background.instanceId)?.style.pointerEvents).toBe('none')
    expect(world.player.runtime.targetElement(image.id)?.style.pointerEvents).toBe('none')
    expect(world.diagnostics).toEqual([])
    const checks = resolve('output/repair-presets/checks')
    await mkdir(checks, { recursive: true })
    await writeFile(resolve(checks, 'presets-image.glx'), saved.bytes)
    await writeFile(resolve(checks, 'image-fixture.json'), JSON.stringify({ backgroundId: background.instanceId, imageId: image.id,
      usedAssetId: 'image-used', unrelatedAssetId: 'image-unrelated', surfaceId: fixture.originId,
      localDesignSize, globalReferenceSize: referenceSize }, null, 2))
  } finally { await world.dispose(); fixture.host.dispose() }
})
