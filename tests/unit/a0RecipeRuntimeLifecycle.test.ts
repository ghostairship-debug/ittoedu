// @vitest-environment node
import { compileFunction, constants } from 'node:vm'
import { JSDOM } from 'jsdom'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { componentCompilationInput } from '../../src/core/components/compilation/componentCompilationInput'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import { ComponentPlatformRuntime } from '../../src/player/components/ComponentPlatformRuntime'
import { ComponentNavigationOwner } from '../../src/renderer/components/ComponentNavigationOwner'
import { planRecipe } from '../../src/renderer/recipes/applyRecipe'
import { recipeDefaults, type RecipeId } from '../../src/renderer/recipes/recipeCatalog'
import type { ComponentRuntimeImplementation } from '../../src/shared/contracts/component-platform/runtime'
import type { ComponentImplementation } from '../../src/shared/contracts/component-platform/project'

/** Use the formal recipe source and the same World/navigation ports that Editor and Player consume. */
async function recipeRuntime(recipeId: RecipeId, initialStep = '0') {
  const original = createBlankCourseProjectV10('配方行为保全')
  const originId = original.surfaces[0].id, resources = { assets: {}, components: {} }
  const slots = recipeDefaults(recipeId)
  if (recipeId === 'step-reveal-v1') slots.initialStep = initialStep
  else slots.mode = 'sort'
  const result = planRecipe(original, { recipeId, slots, target: { documentId: 'recipe-document', epoch: 'recipe-epoch',
    project: original, editingProject: original, resources, surfaceId: originId, instanceIds: [], instanceId: null, activeStateId: null } })
  if (!result.ok) throw new Error(result.reason)
  const model = new CourseV10Driver().apply({ kind: 'course-v10', project: original, resources }, captureComponentOperation(original, result.edits))
  if (model.kind !== 'course-v10') throw new Error('Expected a formal V10 recipe')
  const surface = model.project.surfaces.find(value => value.id === result.createdLocationId)!
  const instance = surface.childIds.map(id => model.project.instances[id]).find(value => model.project.definitions[value.definitionId].implementation.kind === 'source')!
  const dom = new JSDOM('<!doctype html><body><div id="recipe"></div></body>')
  const root = dom.window.document.getElementById('recipe')!
  let currentSurface = surface.id
  const navigation = new ComponentNavigationOwner({ project: () => model.project, surfaceId: () => currentSurface,
    select: id => { currentSurface = id } })
  const compiler = createEsbuildComponentCompiler(), diagnostics: string[] = []
  const prepare = vi.fn(async (implementation: Extract<ComponentImplementation, { kind: 'source' }>) => {
    const compiled = await compiler.compile(componentCompilationInput(model.project, implementation, model.resources))
    if (compiled.status !== 'ready') throw new Error(JSON.stringify(compiled.diagnostics))
    const load = compileFunction('return import(url)', ['url'], { importModuleDynamically: constants.USE_MAIN_CONTEXT_DEFAULT_LOADER })
    const module = await load('data:text/javascript;base64,' + Buffer.from(compiled.artifact.code).toString('base64')) as { default: ComponentRuntimeImplementation }
    return { implementation: module.default }
  })
  const world = new ComponentPlatformRuntime('recipe-preserved-behavior', { teacherController: navigation,
    resolveSource: prepare, report: message => diagnostics.push(message) })
  world.bind(instance.id, root)
  await world.sync(model.project, model.resources)
  // The real scene.enter port also notifies initial mount in a microtask.
  await Promise.resolve()
  return { root, dom, world, navigation, model, instance, originId, surfaceId: surface.id, prepare, diagnostics,
    async dispose() { navigation.cancel(); await world.dispose(); dom.window.close() } }
}

it('restores authored reveal progress after leaving and re-entering the same retained mount', async () => {
  const runtime = await recipeRuntime('step-reveal-v1')
  const { root, world, navigation, model, instance, dom } = runtime
  const user = userEvent.setup({ document: dom.window.document })
  try {
    const steps = () => root.querySelectorAll('.teaching-interaction p').length
    const next = () => [...root.querySelectorAll('button')].find(button => button.textContent === '下一步 →')!
    expect(steps()).toBe(0)
    await user.click(next()); await user.click(next())
    expect(steps()).toBe(2)
    expect(world.getState('progress')).toBe(2)
    expect(await navigation.execute({ type: 'scene.go', sceneId: runtime.originId })).toBe(true)
    world.bind(instance.id, null)
    expect(await navigation.execute({ type: 'scene.go', sceneId: runtime.surfaceId })).toBe(true)
    world.bind(instance.id, root)
    await world.sync(model.project, model.resources)
    expect(runtime.prepare).toHaveBeenCalledTimes(1)
    expect(steps()).toBe(0)
    expect(world.getState('progress')).toBe(0)
    await user.click(next())
    expect(steps()).toBe(1)
    expect(runtime.diagnostics).toEqual([])
  } finally { await runtime.dispose() }
})

it('keeps keyboard focus on the moved item after redraw and chooses its enabled opposite control at the boundary', async () => {
  const runtime = await recipeRuntime('classify-sort-v1')
  const { root, dom } = runtime
  const user = userEvent.setup({ document: dom.window.document })
  try {
    const original = root.querySelector<HTMLButtonElement>('[aria-label="小鸟上移"]')!
    original.focus()
    expect(dom.window.document.activeElement).toBe(original)
    await user.keyboard('{Enter}')
    const moved = root.querySelector<HTMLButtonElement>('[aria-label="小鸟上移"]')!
    expect(moved).not.toBe(original)
    expect(original.isConnected).toBe(false)
    expect(dom.window.document.activeElement).toBe(moved)
    expect([...root.querySelectorAll('.row .label')].map(label => label.textContent)).toEqual(['1. 小猫', '2. 小鸟', '3. 大树'])
    await user.keyboard('{Enter}')
    const opposite = root.querySelector<HTMLButtonElement>('[aria-label="小鸟下移"]')!
    expect(dom.window.document.activeElement).toBe(opposite)
    expect(opposite.disabled).toBe(false)
    expect([...root.querySelectorAll('.row .label')].map(label => label.textContent)).toEqual(['1. 小鸟', '2. 小猫', '3. 大树'])
    expect(runtime.diagnostics).toEqual([])
  } finally { await runtime.dispose() }
})
