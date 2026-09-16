import { createArchiveFixture as createCourseProjectArchive } from '../fixtures/teacherController'
import { describe, expect, it, vi } from 'vitest'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { RECIPE_CATALOG, recipeDefaults, type RecipeId } from '@/renderer/recipes/recipeCatalog'
import { planRecipe } from '@/renderer/recipes/applyRecipe'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import { createEditorTransactionStep, applyEditorTransactionStep } from '@/renderer/authoring/editorTransaction'
import { PublishedInteractionController } from '@/player/interactions/PublishedInteractionController'
import { CourseStateStore } from '@/player/CourseStateStore'
import type { SlideSceneDocument } from '@/shared/courseProjectTypes'
import { createSortComponentPackage } from '@/renderer/recipes/sort-component/package'
import { openCourseProjectArchive } from '@/renderer/project/courseProjectArchive'
import { inspectSingleChoiceRuleFamilies } from '@/shared/singleChoiceRuleFamily'

function make(id: RecipeId, overrides: Record<string, string> = {}) {
  let counter = 0
  const project = createBlankCourseProject()
  const result = planRecipe(project, { recipeId: id, target: { projectId: project.id, revision: project.revision, locationId: project.locations[0].id }, slots: { ...recipeDefaults(id), ...overrides } }, { idFactory: () => String(++counter), now: '2026-09-05T00:00:00.000Z' })
  if (!result.ok) throw new Error(result.reason)
  const surface = result.plan.nextDocument.surfaces[0]
  if (surface.type !== 'slide') throw new Error('wrong surface')
  return { project, result, scene: surface.scenes[1] }
}
async function flush() { for (let n = 0; n < 120; n++) await Promise.resolve() }
function stateFor(declarations: ReturnType<typeof createBlankCourseProject>['courseState']) {
  const state = new CourseStateStore()
  for (const declaration of declarations) state.set(declaration.key, declaration.defaultValue)
  return state
}
function player(scene: SlideSceneDocument, courseState: CourseStateStore) {
  const clicks = new Map<string, () => void>(), visible = new Map(scene.layerItems.map(item => [item.layerItemId, item.playbackInitialVisibility !== 'hidden']))
  const diagnostics: unknown[] = []
  const controller = new PublishedInteractionController({ surfaceId: 'surface', rules: scene.interactions, reportDiagnostic: value => diagnostics.push(value),
    surface: { bindNodeClick(node, callback) { clicks.set(node, callback); return () => clicks.delete(node) }, executeNodeMotion(action) { visible.set(action.nodeId, action.type === 'node.enter'); return true } },
    session: { courseState, currentSceneId: () => scene.id, goToScene: () => false, nextScene: () => false, previousScene: () => false, replayScene: () => false, restartCourse: () => false },
  })
  return { controller, visible, diagnostics, click: async (label: string) => { const node = scene.layerItems.find(item => item.label === label)!; clicks.get(node.layerItemId)!(); await flush() } }
}

describe('ordinary V9 Recipes', () => {
  it.each(RECIPE_CATALOG.map(entry => entry.id))('%s expands into a parseable page in one reversible transaction', id => {
    const { project, result } = make(id)
    expect(courseProjectDocumentSchema.parse(JSON.parse(JSON.stringify(result.plan.nextDocument)))).toEqual(result.plan.nextDocument)
    expect(result.plan.nextDocument.revision).toBe(project.revision + 1)
    expect(result.plan.nextDocument.locations).toHaveLength(project.locations.length + 1)
    const step = createEditorTransactionStep(project, result.plan)!
    const initial = { document: project, resources: { assetFiles: {}, componentPackages: {} } }
    const applied = applyEditorTransactionStep(initial, step, 'forward')
    expect(applyEditorTransactionStep(applied, step, 'inverse')).toEqual(initial)
    expect(JSON.stringify(result.plan.nextDocument)).not.toContain('recipeId')
  })
  it('rejects stale, overcapacity and malformed classifications without mutating the source', () => {
    const project = createBlankCourseProject(), before = structuredClone(project)
    const input = { recipeId: 'classify-sort-v1' as const, target: { projectId: project.id, revision: project.revision, locationId: project.locations[0].id }, slots: recipeDefaults('classify-sort-v1') }
    expect(planRecipe(project, { ...input, target: { ...input.target, revision: 99 } })).toMatchObject({ ok: false, kind: 'invalid' })
    expect(planRecipe(project, { ...input, slots: { ...input.slots, items: 'a | 一 | 动物\na | 二 | 植物' } })).toMatchObject({ ok: false, kind: 'invalid' })
    expect(planRecipe(project, { ...input, slots: { ...input.slots, items: 'a | 一 | 缺失\nb | 二 | 植物' } })).toMatchObject({ ok: false, kind: 'invalid' })
    expect(planRecipe(project, { ...input, slots: { ...input.slots, title: '长'.repeat(80) } })).toMatchObject({ ok: false, kind: 'switch-layout' })
    expect(project).toEqual(before)
    expect(planRecipe(project, { ...input, recipeId: 'cover-v1', slots: { ...recipeDefaults('cover-v1'), subtitle: '一\n二\n三\n四\n五\n六' } })).toMatchObject({ ok: false, kind: 'split-pages' })
  })
  it('reveals exactly one step per click and restores authored initial state on reset and re-entry', async () => {
    const { result, scene } = make('step-reveal-v1')
    const host = player(scene, stateFor(result.plan.nextDocument.courseState))
    const steps = scene.layerItems.filter(item => item.label.startsWith('步骤'))
    host.controller.enterScene(); await flush()
    await host.click('下一步')
    expect(steps.map(item => host.visible.get(item.layerItemId))).toEqual([true, false, false])
    await host.click('下一步'); await host.click('下一步')
    expect(steps.map(item => host.visible.get(item.layerItemId))).toEqual([true, true, true])
    await host.click('重置')
    expect(steps.map(item => host.visible.get(item.layerItemId))).toEqual([false, false, false])
    await host.click('下一步'); host.controller.enterScene(); await flush()
    expect(steps.map(item => host.visible.get(item.layerItemId))).toEqual([false, false, false])
    expect(host.diagnostics).toEqual([]); host.controller.destroy()
  })
  it('classifies by selection then group, allows reassignment, evaluates all items and resets', async () => {
    const { result, scene } = make('classify-sort-v1')
    const host = player(scene, stateFor(result.plan.nextDocument.courseState))
    const visible = (label: string) => host.visible.get(scene.layerItems.find(item => item.label === label)!.layerItemId)
    await host.click('项目 cat'); await host.click('分类组 植物')
    expect(visible('cat → 植物')).toBe(true)
    await host.click('分类组 动物')
    expect(visible('cat → 植物')).toBe(false); expect(visible('cat → 动物')).toBe(true)
    await host.click('检查答案'); expect(visible('错误反馈')).toBe(true)
    await host.click('项目 tree'); await host.click('分类组 植物')
    await host.click('项目 bird'); await host.click('分类组 动物')
    await host.click('检查答案'); expect(visible('正确反馈')).toBe(true); expect(visible('错误反馈')).toBe(false)
    await host.click('重置'); expect(visible('cat → 动物')).toBe(false)
    expect(host.diagnostics).toEqual([]); host.controller.destroy()
  })
  it('choice feedback has one visible answer and resets', async () => {
    const { scene, result } = make('choice-feedback-v1')
    const host = player(scene, stateFor(result.plan.nextDocument.courseState))
    const feedback = scene.layerItems.filter(item => item.label.endsWith('反馈'))
    await host.click('选项 1'); expect(feedback.map(item => host.visible.get(item.layerItemId))).toEqual([true, false, false])
    await host.click('选项 2'); expect(feedback.map(item => host.visible.get(item.layerItemId))).toEqual([false, true, false])
    await host.click('重置'); expect(feedback.map(item => host.visible.get(item.layerItemId))).toEqual([false, false, false])
    host.controller.destroy()
  })
  it('diagnoses only the explicit ordinary single-choice family, including conflicting assignments', () => {
    const { scene, result } = make('choice-feedback-v1')
    expect(inspectSingleChoiceRuleFamilies(result.plan.nextDocument.courseState, scene.interactions)).toEqual([])
    const rules = structuredClone(scene.interactions)
    const correct = rules.flatMap(rule => rule.actions).find(step => step.action.type === 'course-state.set' && step.action.value === true)!
    if (correct.action.type !== 'course-state.set') throw new Error('missing result')
    correct.action.value = false
    expect(inspectSingleChoiceRuleFamilies(result.plan.nextDocument.courseState, rules)[0].code).toBe('missing-correct-answer')
    rules[0].actions.push({ ...structuredClone(correct), id: 'conflict', action: { ...correct.action, value: true } })
    expect(inspectSingleChoiceRuleFamilies(result.plan.nextDocument.courseState, rules).some(finding => finding.code === 'conflicting-option-values')).toBe(true)
  })
  it('embeds actual sorting package bytes and runtime moves DOM order with deterministic feedback and reset', () => {
    const { result } = make('classify-sort-v1', { mode: 'sort' })
    expect(result.plan.resourceChanges.componentPackageChanges).toHaveLength(1)
    const pkg = createSortComponentPackage()
    const archive = createCourseProjectArchive({ project: result.plan.nextDocument, assetFiles: {}, componentFiles: { [pkg.manifest.id]: pkg.files } })
    const reopened = openCourseProjectArchive(archive)
    expect(reopened.project).toEqual(result.plan.nextDocument)
    expect(new TextDecoder().decode(reopened.componentFiles[pkg.key]['runtime.js'])).toBe(pkg.runtimeSource)
    let definition: any
    new Function('window', pkg.runtimeSource)({ CoursewareComponent: { define(value: unknown) { definition = value } } })
    const root = document.createElement('div'), emit = vi.fn()
    const instance = definition.create({ dom: { root }, props: { items: 'b | 二\na | 一', correctOrder: 'a,b', content: { success: '对了', failure: '错了' } }, mode: 'preview', emit })
    const button = (label: string) => [...root.querySelectorAll('button')].find(el => el.textContent === label)!
    button('检查答案').click(); expect(root.textContent).toContain('错了')
    root.querySelector<HTMLButtonElement>('[aria-label="一下移"]')?.click()
    root.querySelector<HTMLButtonElement>('[aria-label="一上移"]')!.click()
    expect([...root.querySelectorAll('.label')].map(el => el.textContent)).toEqual(['1. 一', '2. 二'])
    button('检查答案').click(); expect(root.textContent).toContain('对了')
    button('重置').click(); expect(root.querySelector('.label')?.textContent).toBe('1. 二')
    instance.updateProps({ items: 'a | 一\na | 二', correctOrder: 'a,a' }); expect(root.textContent).toContain('配置无效')
    instance.destroy(); expect(root.children).toHaveLength(0)
  })
})
