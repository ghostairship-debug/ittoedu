// @vitest-environment node
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { planCourseRecipeEdits, recipeDefaults } from '../../src/core/course/courseRecipeEdits'
import { createCourseProductivityPreview, inspectCourseRemixSlots, previewCourseStyleRemix, planCourseProductivityEdits, planCourseStyleRemixEdits, prepareCourseReferenceClone } from '../../src/core/course/courseProductivityEdits'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { TEXT_DEFINITION, createTextComponentData, textComponentDataSchema } from '../../src/components/text'
import { INPUT_DEFINITION, createInputData, inputDataSchema } from '../../src/components/input/data'
import { INTERACTIONS_DEFINITION, interactionRules } from '../../src/shared/componentInteractionData'
import type { ComponentEdit } from '../../src/shared/contracts/component-platform/operations'
import type { CourseProjectV10, JsonValue } from '../../src/shared/contracts/component-platform/project'
import type { DocumentResources } from '../../src/shared/workbench/document'

const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue
async function sessionPlan(project: CourseProjectV10, edits: ComponentEdit[], resources: DocumentResources = { assets: {}, components: {} }) {
  const driver = new CourseV10Driver()
  const session = await DocumentSession.create({ documentId: 'doc', epoch: 'epoch', model: { kind: 'course-v10', project, resources },
    binding: { kind: 'untitled', suggestedName: 'intent.h5lesson' } }, driver, { async append() {}, async save() { throw new Error('archive verification uses the production Driver') } })
  expect(await session.execute({ documentId: 'doc', epoch: 'epoch', operationId: 'intent', baseRevision: project.revision, actor: 'human', mutation: { type: 'command', command: captureComponentOperation(project, edits) } })).toMatchObject({ status: 'applied' })
  const saved = session.read()
  if (saved.model.kind !== 'course-v10') throw new Error('Expected V10')
  expect(saved.undoDepth).toBe(1)
  const reopened = driver.load(driver.serialize(saved.model))
  expect(reopened).toEqual(saved.model)
  expect(await session.execute({ documentId: 'doc', epoch: 'epoch', operationId: 'undo-intent', baseRevision: saved.revision, actor: 'human', mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
  const undone = session.read().model
  expect(undone.kind === 'course-v10' && undone.project.instances).toEqual(project.instances)
  expect(undone.kind === 'course-v10' && undone.project.surfaces).toEqual(project.surfaces)
  expect(undone.resources).toEqual(resources)
  return saved.model
}

it('generates recipe item identities from content and resolves authored correct order before one saved Session operation', async () => {
  const project = createBlankCourseProjectV10('内容排序'), original = structuredClone(project)
  let serial = 0
  const plan = planCourseRecipeEdits(project, { recipeId: 'classify-sort-v1', surfaceId: project.surfaces[0].id,
    slots: { ...recipeDefaults('classify-sort-v1'), mode: 'sort', items: '观察\n比较\n解释', correctOrder: '解释\n观察\n比较' } }, { createId: () => `prepared-${++serial}` })
  if (!plan.ok) throw new Error(plan.reason)
  const model = await sessionPlan(project, plan.edits)
  const surface = model.project.surfaces.find(surface => surface.id === plan.createdLocationId)!
  const interactive = surface.childIds.map(id => model.project.instances[id]).find(item => item.name === '教学互动')!
  const data = interactive.data as { items: { id: string; text: string }[]; correctOrder: string[] }
  expect(data.items.map(item => item.text)).toEqual(['观察', '比较', '解释'])
  expect(new Set(data.items.map(item => item.id)).size).toBe(3)
  expect(data.correctOrder.map(id => data.items.find(item => item.id === id)!.text)).toEqual(['解释', '观察', '比较'])
  expect(data.items.every(item => !['观察', '比较', '解释'].includes(item.id))).toBe(true)
  expect(project).toEqual(original)
})

it('accepts classification text and ordinals for repeated sort text, while retiring the stable-ID input format', () => {
  const project = createBlankCourseProjectV10(), surfaceId = project.surfaces[0].id, defaults = recipeDefaults('classify-sort-v1')
  const classification = planCourseRecipeEdits(project, { recipeId: 'classify-sort-v1', surfaceId, slots: defaults })
  expect(classification.ok).toBe(true)
  const ordered = planCourseRecipeEdits(project, { recipeId: 'classify-sort-v1', surfaceId, slots: { ...defaults, mode: 'sort', items: '相同\n不同\n相同', correctOrder: '3,2,1' } })
  expect(ordered.ok).toBe(true)
  expect(planCourseRecipeEdits(project, { recipeId: 'classify-sort-v1', surfaceId, slots: { ...defaults, items: 'cat | 小猫 | 动物\ntree | 大树 | 植物' } })).toMatchObject({ ok: false, kind: 'invalid' })
  expect(planCourseRecipeEdits(project, { recipeId: 'classify-sort-v1', surfaceId, slots: { ...defaults, mode: 'sort', items: '相同\n不同\n相同', correctOrder: '相同,不同,相同' } })).toMatchObject({ ok: false, kind: 'invalid' })
})

it.each([
  { items: '10\n20\n30', order: '30,10,20', expected: ['30', '10', '20'] },
  { items: '2\n1', order: '1,2', expected: ['1', '2'] },
  { items: '观察\n比较\n解释', order: '3,1,2', expected: ['解释', '观察', '比较'] },
  { items: '2\n1', order: '序号：1,2', expected: ['2', '1'] },
])('resolves numeric recipe content and explicit ordinal intent: $items / $order', async ({ items, order, expected }) => {
  const project = createBlankCourseProjectV10('数字排序语义')
  const plan = planCourseRecipeEdits(project, { recipeId: 'classify-sort-v1', surfaceId: project.surfaces[0].id,
    slots: { ...recipeDefaults('classify-sort-v1'), mode: 'sort', items, correctOrder: order } })
  if (!plan.ok) throw new Error(plan.reason)
  const model = await sessionPlan(project, plan.edits)
  const surface = model.project.surfaces.find(value => value.id === plan.createdLocationId)!
  const interactive = surface.childIds.map(id => model.project.instances[id]).find(item => item.name === '教学互动')!
  const data = interactive.data as { items: { id: string; text: string }[]; correctOrder: string[] }
  expect(data.correctOrder.map(id => data.items.find(item => item.id === id)!.text)).toEqual(expected)
  expect(new Set(data.items.map(item => item.id)).size).toBe(data.items.length)
})

it('rejects partially matching numeric recipe text instead of silently guessing ordinals', () => {
  const project = createBlankCourseProjectV10('混合数字排序'), before = structuredClone(project)
  const plan = planCourseRecipeEdits(project, { recipeId: 'classify-sort-v1', surfaceId: project.surfaces[0].id,
    slots: { ...recipeDefaults('classify-sort-v1'), mode: 'sort', items: '2\n3\n4', correctOrder: '1,2,3' } })
  expect(plan).toMatchObject({ ok: false, kind: 'invalid', reason: expect.stringContaining('序号：') })
  expect(project).toEqual(before)
})

function reference() {
  const project = createBlankCourseProjectV10('完整参考页'), surface = project.surfaces[0]
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  project.definitions[INPUT_DEFINITION.id] = INPUT_DEFINITION
  project.definitions[INTERACTIONS_DEFINITION.id] = INTERACTIONS_DEFINITION
  project.definitions.custom = { id: 'custom', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default {}' } }
  project.instances.text = { id: 'text', definitionId: TEXT_DEFINITION.id, name: '课题', data: json(createTextComponentData({ inlines: [{ type: 'text', text: '旧头' }, { type: 'text', text: '强调', style: { bold: true } }, { type: 'text', text: '旧尾' }] })), frame: { width: 340, height: 70, transform: [1, .2, .3, 1, 25, 42] } }
  project.instances.input = { id: 'input', definitionId: INPUT_DEFINITION.id, data: json(createInputData({ stateKey: 'interaction:input', answer: { type: 'text', stateKey: 'input:input:value', validityKey: 'input:input:valid', ruleFamilyRuleIds: ['rule'] } })) }
  project.instances.behavior = { id: 'behavior', definitionId: INTERACTIONS_DEFINITION.id, attachments: [{ instanceId: 'behavior', target: { kind: 'surface', surfaceId: surface.id } }], data: json({ rules: [{ id: 'rule', enabled: true,
    trigger: { type: 'presentation.enter', stateId: 'answer' }, conditions: [{ type: 'presentation.in', stateIds: ['answer'] }, { type: 'course-state.exists', key: 'input:input:value', exists: true }],
    actions: [{ id: 'step-state', start: 'after-previous', delayMs: 0, action: { type: 'presentation.set', stateId: 'answer' } }, { id: 'step-variable', start: 'after-previous', delayMs: 0, action: { type: 'course-state.set', key: 'author-variable', value: 'answer' } }, { id: 'step-self', start: 'after-previous', delayMs: 0, action: { type: 'scene.go', sceneId: surface.id, targetStateId: 'answer' } }] },
    { id: 'external-rule', enabled: true, trigger: { type: 'node.click', nodeId: 'text' }, conditions: [], actions: [{ id: 'step-external', start: 'after-previous', delayMs: 0, action: { type: 'scene.go', sceneId: 'external', targetStateId: 'answer' } }] }] }) }
  project.instances.program = { id: 'program', definitionId: 'custom', data: { assetId: 'logo', stateId: 'answer', caption: 'answer' } }
  project.instances.nav = { ...structuredClone(project.instances[project.global.overlay[0]]), id: 'nav', data: { buttons: [{ id: 'button', label: 'answer', action: { type: 'scene.go', sceneId: surface.id, targetStateId: 'answer' } }] } }
  surface.childIds = ['text', 'input', 'behavior', 'program', 'nav']
  surface.presentation = { initialStateId: 'answer', thumbnailStateId: 'answer', states: [{ id: 'answer', title: '答案', overrides: { text: { visible: false }, behavior: { data: project.instances.behavior.data } }, order: ['program', 'text', 'input', 'behavior', 'nav'] }] }
  project.surfaces.push({ id: 'external', kind: 'slide', title: '外部页面', childIds: [], presentation: { states: [{ id: 'answer', title: '同名但外部状态', overrides: {} }] } })
  project.instances.decoration = { id: 'decoration', definitionId: TEXT_DEFINITION.id, data: json(createTextComponentData('共享装饰')), visibility: { mode: 'include', surfaceIds: [surface.id] } }
  project.global.overlay.push('decoration')
  project.assets.logo = { id: 'logo', path: 'assets/logo.svg', mimeType: 'image/svg+xml' }
  project.logic = { courseState: [{ key: 'input:input:value', valueType: 'string', defaultValue: '' }, { key: 'input:input:valid', valueType: 'boolean', defaultValue: false }, { key: 'author-variable', valueType: 'string', defaultValue: 'answer' }], navigationGuards: [] }
  return { project, surface, resources: { assets: { logo: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>') }, components: {} } }
}

it('uses the full formal copy for reference and remix: named states, rule families, scope, shared assets and opaque author data survive', async () => {
  const { project, surface, resources } = reference(), original = structuredClone(project)
  const slots = inspectCourseRemixSlots(project, surface.id)
  expect(slots.slots.map(slot => slot.original)).toEqual(['旧头强调旧尾'])
  const cloned = prepareCourseReferenceClone(project, surface.id)
  expect(cloned.edits.some(edit => edit.type === 'instance.patch' && edit.instanceId === 'decoration')).toBe(true)
  const plan = planCourseStyleRemixEdits(project, surface.id, { [slots.slots[0].id]: '新头强调新尾' })
  const model = await sessionPlan(project, plan.edits, resources)
  const copy = model.project.surfaces.find(value => value.id === plan.createdSurfaceId)!, state = copy.presentation!.states[0]
  const id = (sourceId: string) => plan.instanceIds.get(sourceId)!
  expect(state.id).not.toBe('answer')
  expect(copy.presentation).toMatchObject({ initialStateId: state.id, thumbnailStateId: state.id })
  expect(state.order).toEqual(['program', 'text', 'input', 'behavior', 'nav'].map(id))
  expect(state.overrides[id('text')]).toEqual({ visible: false })
  expect(model.project.instances[id('text')].frame).toEqual(project.instances.text.frame)
  expect(textComponentDataSchema.parse(model.project.instances[id('text')].data).content.inlines).toEqual([{ type: 'text', text: '新头' }, { type: 'text', text: '强调', style: { bold: true } }, { type: 'text', text: '新尾' }])
  const rule = interactionRules(model.project.instances[id('behavior')])[0]
  expect(rule.trigger).toEqual({ type: 'presentation.enter', stateId: state.id })
  expect(rule.conditions[0]).toEqual({ type: 'presentation.in', stateIds: [state.id] })
  expect(rule.actions[0].action).toEqual({ type: 'presentation.set', stateId: state.id })
  expect(rule.actions[1].action).toEqual({ type: 'course-state.set', key: 'author-variable', value: 'answer' })
  expect(rule.actions[2].action).toEqual({ type: 'scene.go', sceneId: copy.id, targetStateId: state.id })
  expect(interactionRules(model.project.instances[id('behavior')])[1].actions[0].action).toEqual({ type: 'scene.go', sceneId: 'external', targetStateId: 'answer' })
  const input = inputDataSchema.parse(model.project.instances[id('input')].data)
  expect(rule.conditions[1]).toEqual({ type: 'course-state.exists', key: `input:${id('input')}:value`, exists: true })
  const stateRule = interactionRules({ ...model.project.instances[id('behavior')], data: state.overrides[id('behavior')].data! })[0]
  expect(stateRule.trigger).toEqual({ type: 'presentation.enter', stateId: state.id })
  expect(stateRule.conditions[1]).toEqual(rule.conditions[1])
  expect(input.answer).toMatchObject({ stateKey: `input:${id('input')}:value`, validityKey: `input:${id('input')}:valid`, ruleFamilyRuleIds: [rule.id] })
  expect(model.project.logic!.courseState.some(item => item.key === input.answer!.stateKey)).toBe(true)
  expect(model.project.instances[id('program')].data).toEqual(project.instances.program.data)
  expect(model.project.instances[id('nav')].data).toEqual({ buttons: [{ id: 'button', label: 'answer', action: { type: 'scene.go', sceneId: copy.id, targetStateId: state.id } }] })
  expect(model.project.instances.decoration.visibility!.surfaceIds).toEqual([surface.id, copy.id])
  expect(model.resources.assets.logo).toEqual(resources.assets.logo)
  expect(project).toEqual(original)
})

it('lets ordinary batch intent reuse the human scan without assembling field paths and preserves custom program data', async () => {
  const { project, surface, resources } = reference()
  const request = { kind: 'text' as const, scope: 'page' as const, find: '旧', replacement: '新' }
  const preview = createCourseProductivityPreview(project, surface.id, request)
  const plan = planCourseProductivityEdits(project, surface.id, request)
  expect(plan.items).toEqual(preview.items)
  expect(plan.unsupported.some(item => item.includes('自定义组件'))).toBe(true)
  const model = await sessionPlan(project, plan.edits, resources)
  expect(textComponentDataSchema.parse(model.project.instances.text.data).content.inlines.map(item => item.type === 'text' ? item.text : '').join('')).toBe('新头强调新尾')
  expect(model.project.instances.program).toEqual(project.instances.program)
  expect(model.project.surfaces).toEqual(project.surfaces)
})


it.each(['新头强调新尾', ''])('applies partial remix intent with explicit text %j and preserves omitted slots', async replacement => {
  const { project, surface, resources } = reference()
  project.instances.second = { id: 'second', definitionId: TEXT_DEFINITION.id, name: '保留正文', data: json(createTextComponentData({ inlines: [{ type: 'text', text: '保留第二正文', style: { italic: true } }] })), frame: { width: 260, height: 80, transform: [1, 0, .1, 1, 500, 160] } }
  surface.childIds.push('second')
  const before = structuredClone(project), observed = inspectCourseRemixSlots(project, surface.id)
  expect(observed.slots.map(slot => slot.instanceId)).toEqual(['text', 'second'])
  const plan = planCourseStyleRemixEdits(project, surface.id, { [observed.slots[0].id]: replacement })
  const model = await sessionPlan(project, plan.edits, resources), firstId = plan.instanceIds.get('text')!, secondId = plan.instanceIds.get('second')!
  expect(textComponentDataSchema.parse(model.project.instances[firstId].data).content.inlines.map(inline => inline.type === 'text' ? inline.text : '').join('')).toBe(replacement)
  expect(model.project.instances[secondId].data).toEqual(project.instances.second.data)
  expect(model.project.instances[firstId].frame).toEqual(project.instances.text.frame)
  expect(model.project.instances[secondId].frame).toEqual(project.instances.second.frame)
  expect(project).toEqual(before)
})

it('diagnoses unknown observed slots for partial remix intent without changing the source', () => {
  const { project, surface } = reference(), before = structuredClone(project)
  expect(() => planCourseStyleRemixEdits(project, surface.id, { missing: '' })).toThrow('已不存在')
  expect(project).toEqual(before)
})


it('inspects remix slots without form-required issues and preserves genuine structural diagnostics', () => {
  const { project, surface } = reference()
  project.instances.mixed = { id: 'mixed', definitionId: TEXT_DEFINITION.id, name: '混合公式', data: json(createTextComponentData({ inlines: [{ type: 'text', text: '保留公式' }, { type: 'math', formulaId: 'math-a', latex: 'x^2', accessibleText: 'x平方' }] })) }
  surface.childIds.push('mixed')
  const before = structuredClone(project), observed = inspectCourseRemixSlots(project, surface.id)
  expect(observed.slots).toHaveLength(1)
  expect(observed.slots[0]).toMatchObject({ instanceId: 'text', original: '旧头强调旧尾' })
  expect(observed.slots[0].issue).toBeUndefined()
  expect(observed.issues).toEqual(['混合公式：保留公式混排，请在原页局部精修'])
  expect(previewCourseStyleRemix(project, surface.id, {}).slots[0].issue).toBe('请填写此槽位')
  expect(project).toEqual(before)
})
