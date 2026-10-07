// @vitest-environment node
import { compileFunction, constants } from 'node:vm'
import { JSDOM } from 'jsdom'
import { expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { componentCompilationInput } from '../../src/core/components/compilation/componentCompilationInput'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import { ComponentPlatformRuntime } from '../../src/player/components/ComponentPlatformRuntime'
import { ComponentNavigationOwner } from '../../src/renderer/components/ComponentNavigationOwner'
import { planRecipe } from '../../src/renderer/recipes/applyRecipe'
import { recipeDefaults } from '../../src/renderer/recipes/recipeCatalog'
import type { ComponentImplementation, ComponentRuntimeImplementation, ComponentRuntimeScope } from '../../src/shared/contracts/component-platform'

it('replays the actual reveal recipe once in its retained scene while preserving course/global/other-scene state', async () => {
  const original = createBlankCourseProjectV10('当前页重播'), originId = original.surfaces[0].id
  const result = planRecipe(original, { recipeId: 'step-reveal-v1', slots: recipeDefaults('step-reveal-v1'),
    target: { documentId: 'r3-document', epoch: 'r3-epoch', project: original, editingProject: original,
      resources: { assets: {}, components: {} }, surfaceId: originId, instanceIds: [], instanceId: null, activeStateId: null } })
  if (!result.ok) throw new Error(result.reason)
  const model = new CourseV10Driver().apply({ kind: 'course-v10', project: original, resources: { assets: {}, components: {} } }, captureComponentOperation(original, result.edits))
  if (model.kind !== 'course-v10') throw new Error('Expected the formal recipe model')
  const surface = model.project.surfaces.find(value => value.id === result.createdLocationId)!
  const instance = surface.childIds.map(id => model.project.instances[id]).find(value => model.project.definitions[value.definitionId].implementation.kind === 'source')!
  model.project.logic = { courseState: [{ key: 'course-kept', valueType: 'number', defaultValue: 0 }], navigationGuards: [] }
  // Probes use the real scene.enter port; the current probe is nested inside the recipe owner.
  model.project.definitions['r3-probe'] = { id: 'r3-probe', role: 'behavior', implementation: { kind: 'builtin', key: 'r3-probe' } }
  for (const id of ['local-probe', 'global-probe', 'other-probe']) model.project.instances[id] = { id, definitionId: 'r3-probe', data: {} }
  instance.childIds = ['local-probe']
  model.project.global.overlay.push('global-probe')
  model.project.surfaces.find(value => value.id === originId)!.childIds.push('other-probe')
  const authorBefore = structuredClone(model)
  const dom = new JSDOM('<!doctype html><body><div id="recipe"></div></body>'), root = dom.window.document.getElementById('recipe')!
  let currentSurface = surface.id, cancelPresent: (() => void) | undefined
  const restart = vi.fn(), replay = vi.fn()
  const navigation = new ComponentNavigationOwner({ project: () => model.project, surfaceId: () => currentSurface,
    select: id => { currentSurface = id }, selectState: () => { cancelPresent?.() }, restart })
  const offReplay = navigation.subscribeSceneReplay(replay)
  const enters = new Map<string, number>(), scopes = new Map<string, ComponentRuntimeScope>()
  const disposed = vi.fn(), compiler = createEsbuildComponentCompiler(), diagnostics: string[] = []
  const prepare = vi.fn(async (implementation: Extract<ComponentImplementation, { kind: 'source' }>) => {
    const compiled = await compiler.compile(componentCompilationInput(model.project, implementation, model.resources))
    if (compiled.status !== 'ready') throw new Error(JSON.stringify(compiled.diagnostics))
    const load = compileFunction('return import(url)', ['url'], { importModuleDynamically: constants.USE_MAIN_CONTEXT_DEFAULT_LOADER })
    const module = await load('data:text/javascript;base64,' + Buffer.from(compiled.artifact.code).toString('base64')) as { default: ComponentRuntimeImplementation }
    return { implementation: module.default }
  })
  const world = new ComponentPlatformRuntime('r3-local-replay', { teacherController: navigation, resolveSource: prepare,
    report: message => diagnostics.push(message), builtins: new Map<string, ComponentRuntimeImplementation>([['r3-probe', { mount(context) {
      scopes.set(context.instance.id, context.scope)
      const off = context.interactions!.subscribeTrigger({ type: 'scene.enter' }, () => enters.set(context.instance.id, (enters.get(context.instance.id) ?? 0) + 1))
      context.scope.cleanup(off)
      return { update() {}, dispose() { off(); disposed(context.instance.id) } }
    } }]]) })
  try {
    world.bind(instance.id, root)
    await world.sync(model.project, model.resources); await Promise.resolve()
    const next = () => [...root.querySelectorAll('button')].find(button => button.textContent === '下一步 →')!
    next().click(); next().click()
    expect(root.querySelectorAll('.teaching-interaction p')).toHaveLength(2)
    expect(world.getState('progress')).toBe(2)
    world.setPlaying(false); world.setPlaying(true)
    expect(root.querySelectorAll('.teaching-interaction p')).toHaveLength(2)
    expect(world.getState('progress')).toBe(2)
    world.setState('course-kept', 99); world.setState('global-kept', 77); world.setState('other-kept', 55)
    const initialEnters = new Map(enters), retainedRoot = world.contentElement(instance.id), retainedScopes = [...scopes.values()]
    expect(await navigation.execute({ type: 'scene.replay' })).toBe(true)
    expect(root.querySelectorAll('.teaching-interaction p')).toHaveLength(0)
    expect(world.getState('progress')).toBe(0)
    expect(enters.get('local-probe')).toBe(initialEnters.get('local-probe')! + 1)
    expect(enters.get('global-probe')).toBe(initialEnters.get('global-probe'))
    expect(enters.get('other-probe')).toBe(initialEnters.get('other-probe'))
    expect(world.getState('course-kept')).toBe(99); expect(world.getState('global-kept')).toBe(77); expect(world.getState('other-kept')).toBe(55)
    expect(world.contentElement(instance.id)).toBe(retainedRoot)
    expect(retainedScopes.every(scope => scope.isActive())).toBe(true)
    expect(prepare).toHaveBeenCalledTimes(1); expect(disposed).not.toHaveBeenCalled(); expect(restart).not.toHaveBeenCalled()
    expect(replay).toHaveBeenCalledExactlyOnceWith(surface.id)
    // Cancellation during the existing presentation port is not a successful replay fact.
    next().click()
    const abort = new AbortController(); cancelPresent = () => abort.abort()
    expect(await navigation.execute({ type: 'scene.replay' }, abort.signal)).toBe(false)
    expect(root.querySelectorAll('.teaching-interaction p')).toHaveLength(1)
    expect(replay).toHaveBeenCalledTimes(1)
    cancelPresent = undefined
    let zoom = 2, scroll = 160
    const stopObservation = navigation.registerObservation(surface.id, { readZoom: () => zoom, setZoom: value => { zoom = value }, reset: () => { zoom = 1; scroll = 0 } })
    navigation.moveBy(20, 30)
    world.setPlaying(false)
    expect(await navigation.replayCurrentSurface()).toBe(true)
    expect(currentSurface).toBe(surface.id); expect(world.isPlaying()).toBe(false)
    expect(root.querySelectorAll('.teaching-interaction p')).toHaveLength(0); expect(world.getState('progress')).toBe(0)
    expect(zoom).toBe(1); expect(scroll).toBe(0); expect(navigation.placement()).toEqual({ x: 0, y: 0, zoom: 1 })
    expect(world.getState('course-kept')).toBe(99); expect(world.getState('other-kept')).toBe(55)
    expect(prepare).toHaveBeenCalledTimes(1); expect(disposed).not.toHaveBeenCalled(); expect(restart).not.toHaveBeenCalled()
    stopObservation()
    expect(model).toEqual(authorBefore); expect(diagnostics).toEqual([])
  } finally { offReplay(); await world.dispose(); navigation.dispose(); dom.window.close() }
  expect([...scopes.values()].every(scope => !scope.isActive())).toBe(true)
  expect(disposed).toHaveBeenCalledTimes(3)
})

it('restarts to the first scene after reset state blocks ordinary entry, retaining the ordinary guard', async () => {
  const project = createBlankCourseProjectV10('课程重启'), first = project.surfaces[0].id
  project.surfaces.push({ ...project.surfaces[0], id: 'later', title: '后页', childIds: [] })
  project.logic = { courseState: [{ key: 'unlocked', valueType: 'boolean', defaultValue: false }], navigationGuards: [
    { id: 'locked-first', effect: 'block', toSurfaceIds: [first], match: 'all',
      conditions: [{ type: 'compare', key: 'unlocked', operator: 'eq', value: false }], message: '首页被普通访问规则锁定' },
  ] }
  let currentSurface = 'later', world!: ComponentPlatformRuntime
  const reports: string[] = [], restart = vi.fn(() => world.resetPlayback(true))
  const navigation = new ComponentNavigationOwner({ project: () => project, surfaceId: () => currentSurface,
    select: id => { currentSurface = id }, restart, report: message => reports.push(message), courseState: { get: key => world.getState(key) as never } })
  world = new ComponentPlatformRuntime('r3-restart-guard', { teacherController: navigation })
  try {
    await world.sync(project, { assets: {}, components: {} }); world.setState('unlocked', true)
    expect(navigation.canExecute({ type: 'scene.go', sceneId: first })).toBe(true)
    expect(await navigation.execute({ type: 'course.restart' })).toBe(true)
    expect(restart).toHaveBeenCalledTimes(1); expect(currentSurface).toBe(first); expect(world.getState('unlocked')).toBe(false)
    currentSurface = 'later'; navigation.changed()
    expect(navigation.canExecute({ type: 'scene.go', sceneId: first })).toBe(false)
    expect(await navigation.execute({ type: 'scene.go', sceneId: first })).toBe(false)
    expect(currentSurface).toBe('later'); expect(reports).toEqual(['首页被普通访问规则锁定'])
    expect(navigation.teacherPort().canExecute({ type: 'scene.go', sceneId: first })).toBe(true)
    expect(navigation.teacherPort().canExecute({ type: 'scene.go', sceneId: first, targetStateId: 'missing' })).toBe(false)
    expect(await navigation.teacherPort().execute({ type: 'scene.go', sceneId: first })).toBe(true)
    expect(currentSurface).toBe(first)
  } finally { await world.dispose(); navigation.dispose() }
})
