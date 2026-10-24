import { interactionRules } from '../../src/shared/componentInteractionData'
// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData, textComponentDataSchema } from '../../src/components/text/data'
import { chartDataSchema } from '../../src/components/chart/data'
import { parseTableData } from '../../src/components/table/data'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { flowTextSelectionTarget } from '../../src/core/tools/ToolTargets'
import { componentDefinitionBuiltinKey, owningContainer } from '../../src/shared/contracts/component-platform/project'
import { plainDocumentText, type FlowTextContent } from '../../src/shared/document/content'
import type { DocumentSelection } from '../../src/shared/document/ports'
import type { ToolResult, ToolTarget } from '../../src/shared/workbench/tools'
import { appendRootContainers, testContainerInstance } from '../helpers/glxWorkFixture'

const content: FlowTextContent = { inlines: [
  { type: 'text', text: '甲😀', style: { bold: true } },
  { type: 'math', formulaId: 'math-a', latex: 'x^2', accessibleText: 'x²' },
  { type: 'text', text: '乙丙丁', style: { color: '#123456' } },
] }

function seed() {
  const project = createBlankCourseProjectV10('Gateway插入与分栏'), root = testContainerInstance(project, 0)
  root.container.kind = 'flow'
  project.definitions[TEXT_DEFINITION.id] = structuredClone(TEXT_DEFINITION)
  project.instances.a = { id: 'a', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextComponentData(content))),
    frame: { width: 500, height: 72, transform: [1, 0, 0, 1, 17, 23] }, style: { color: '#abcdef' } }
  project.instances.b = { id: 'b', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextComponentData('相邻正文'))),
    frame: { width: 400, height: 70, transform: [1, 0, 0, 1, 3, 99] } }
  project.instances.foreign = { id: 'foreign', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextComponentData('另一页'))), }
  root.childIds = ['a', 'b']
  appendRootContainers(project, { id: 'other', kind: 'flow', title: '另一页', childIds: ['foreign'] })
  return project
}

async function fixture(readOnly = false, nested = false, customize?: (project: ReturnType<typeof seed>) => void) {
  const project = seed(), surfaceId = project.rootIds[0], driver = new CourseV10Driver()
  if (nested) {
    project.definitions.group = { id: 'group', role: 'mixed', implementation: { kind: 'builtin', key: 'guoling.group' } }
    project.instances.nested = { id: 'nested', definitionId: 'group', data: {}, childIds: ['b'], style: { display: 'flex', flexDirection: 'column' } }
    testContainerInstance(project, surfaceId).childIds = ['a', 'nested']
  }
  customize?.(project)
  const registry = new DocumentRegistry({ drivers: [driver], createId: randomUUID, bindingKey: binding => binding.path,
    persistence: { async append() {}, async save() { throw new Error('No disk write requested') } } })
  const session = await registry.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'gateway.glx')
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID)
  await gateway.beginRun({ runId: 'gateway-insertion', actor: 'agent', documents: [{ documentId: session.documentId,
    writable: readOnly ? [] : [{ kind: 'document' }] }] })
  const model = () => { const value = session.read().model; if (value.kind !== 'course-v10') throw new Error('Expected course'); return value }
  const handle = (target: ToolTarget) => gateway.issueTarget('gateway-insertion', session.documentId, target)
  const call = (name: string, input: Record<string, unknown>) => gateway.execute('gateway-insertion', randomUUID(), { name, input })
  const undo = async () => {
    const current = session.read()
    expect(await session.execute({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
      operationId: randomUUID(), actor: 'human', mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
  }
  const selection = async (anchor: number, head: number) => {
    const range: Extract<DocumentSelection, { kind: 'text' }> = { kind: 'text', revision: String(session.read().revision),
      anchor: { blockId: 'a', slot: { kind: 'field', field: 'content' }, offset: anchor, affinity: 'after' },
      head: { blockId: 'a', slot: { kind: 'field', field: 'content' }, offset: head, affinity: 'after' } }
    return handle(flowTextSelectionTarget(model(), surfaceId, range))
  }
  return { project, surfaceId, driver, registry, session, gateway, model, handle, call, undo, selection }
}

function applied(result: ToolResult) {
  expect(result, JSON.stringify(result)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
}

it.each(['flow', 'slide'] as const)('settles %s relationships after every mutation and acknowledges the final model', async kind => {
  const annotated = createTextComponentData({ inlines: [{ type: 'text', text: '保留范围', rangeIds: ['R'] }] })
  const h = await fixture(false, false, project => {
    project.instances.a.data = JSON.parse(JSON.stringify(annotated))
    project.instances.a.childIds = ['note']
    project.definitions.note = { id: 'note', role: 'behavior', implementation: { kind: 'builtin', key: 'guoling.popover' } }
    project.instances.note = { id: 'note', definitionId: 'note', data: { label: '注释', content: '同一内容' }, attachments: [
      { instanceId: 'note', target: { kind: 'text-range', instanceId: 'a', dataPath: ['content'], rangeId: 'R' } },
    ] }
    if (kind === 'slide') testContainerInstance(project, 0).container = { kind: 'slide', presentation: { states: [{ id: 'saved', title: '后续版本', overrides: {} }] } }
  })
  const base = await h.handle({ kind: 'course-instance', surfaceId: h.surfaceId, instanceId: 'a' })
  const state = await h.handle({ kind: 'course-instance', surfaceId: h.surfaceId, instanceId: 'a', ...(kind === 'slide' ? { stateId: 'saved' } : {}) })
  const result = await h.call('batch', { operations: [
    { name: 'object.update', input: { target: base, properties: { data: createTextComponentData('暂时清空') } } },
    { name: 'object.update', input: { target: state, properties: { data: annotated } } },
  ] })
  applied(result)
  expect(h.model().project.instances.note.data).toEqual(h.project.instances.note.data)
  expect(owningContainer(h.model().project, 'note')).toEqual({ kind: 'instance', instanceId: kind === 'flow' ? h.surfaceId : 'a' })
  expect(h.session.read().undoDepth).toBe(1)
  if (result.kind !== 'document-operation') throw new Error('Expected receipt')
  // An ACK handle must reflect the relationship move performed by final preparation.
  applied(await h.call('object.update', { target: result.affected[0], properties: { label: '继续编辑' } }))
  await h.undo()
  await h.undo()
  expect(h.model().project.instances).toEqual(h.project.instances)
})

it.each([
  { label: 'emoji后的折叠光标', anchor: 2, head: 2, before: '甲😀', after: 'x²乙丙丁' },
  { label: '反向非折叠选区的逻辑末端', anchor: 4, head: 1, before: '甲😀x²乙', after: '丙丁' },
])('inserts chart data at the observed $label in one Session undo', async sample => {
  const h = await fixture(), target = await h.handle({ kind: 'course-surface', surfaceId: h.surfaceId }), at = await h.selection(sample.anchor, sample.head)
  const before = h.session.read()
  applied(await h.call('object.insert', { target, at, kind: 'chart', chartType: 'line', chart: {
    categories: [{ label: '第一天' }, { label: '第二天' }], series: [{ name: '温度', values: [-2, 7] }],
  } }))
  const changed = h.model(), ids = testContainerInstance(changed.project, h.surfaceId).childIds
  expect(ids).toHaveLength(4)
  expect(ids[0]).toBe('a')
  expect(ids[3]).toBe('b')
  const chart = changed.project.instances[ids[1]], remainder = changed.project.instances[ids[2]]
  expect(componentDefinitionBuiltinKey(changed.project.definitions[chart.definitionId])).toBe('guoling.chart')
  expect(chartDataSchema.parse(chart.data)).toMatchObject({ chartType: 'line', categories: [{ label: '第一天' }, { label: '第二天' }],
    series: [{ name: '温度', points: [{ value: -2 }, { value: 7 }] }] })
  expect(plainDocumentText(textComponentDataSchema.parse(changed.project.instances.a.data).content)).toBe(sample.before)
  expect(plainDocumentText(textComponentDataSchema.parse(remainder.data).content)).toBe(sample.after)
  const allInlines = [textComponentDataSchema.parse(changed.project.instances.a.data).content, textComponentDataSchema.parse(remainder.data).content].flatMap(value => value.inlines)
  expect(allInlines.filter(inline => inline.type === 'math')).toEqual([content.inlines[1]])
  expect(allInlines.filter(inline => inline.type === 'text').every(inline => inline.style)).toBe(true)
  expect(changed.project.instances.b).toEqual(h.project.instances.b)
  expect(h.session.read().undoDepth).toBe(before.undoDepth + 1)
  expect(h.driver.load(h.driver.serialize(changed))).toEqual(changed)
  await h.undo()
  expect(h.model().project.instances).toEqual(h.project.instances)
  expect(testContainerInstance(h.model().project, h.surfaceId).childIds).toEqual(['a', 'b'])
})

it('inserts after an observed sibling and refuses a different-container after without appending', async () => {
  const h = await fixture(), target = await h.handle({ kind: 'course-surface', surfaceId: h.surfaceId })
  const after = await h.handle({ kind: 'course-instance', surfaceId: h.surfaceId, instanceId: 'a' })
  applied(await h.call('object.insert', { target, after, kind: 'table' }))
  const ids = testContainerInstance(h.model().project, h.surfaceId).childIds
  expect(ids).toHaveLength(3)
  expect([ids[0], ids[2]]).toEqual(['a', 'b'])
  expect(parseTableData(h.model().project.instances[ids[1]].data).rows).toHaveLength(3)
  await h.undo()
  const wrong = await fixture(false, true), wrongTarget = await wrong.handle({ kind: 'course-surface', surfaceId: wrong.surfaceId })
  const wrongAfter = await wrong.handle({ kind: 'course-instance', surfaceId: wrong.surfaceId, instanceId: 'b' }), before = wrong.session.read()
  expect(await wrong.call('object.insert', { target: wrongTarget, after: wrongAfter, kind: 'table' })).toMatchObject({ kind: 'error' })
  expect(wrong.session.read().revision).toBe(before.revision)
  expect(wrong.model().project.instances).toEqual(wrong.project.instances)
  expect(testContainerInstance(wrong.model().project, wrong.surfaceId).childIds).toEqual(['a', 'nested'])
})

it('creates reading columns through Gateway while retaining original objects and one undo', async () => {
  const h = await fixture(), a = await h.handle({ kind: 'course-instance', surfaceId: h.surfaceId, instanceId: 'a' }),
    b = await h.handle({ kind: 'course-instance', surfaceId: h.surfaceId, instanceId: 'b' }), before = h.session.read()
  applied(await h.call('object.layout', { targets: [b, a], intent: { kind: 'columns', ratios: [2, 1], gap: 20 } }))
  const changed = h.model(), children = testContainerInstance(changed.project, h.surfaceId).childIds
  expect(children).toHaveLength(1)
  const group = changed.project.instances[children[0]]
  expect(group.style).toMatchObject({ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 20 })
  expect(group.childIds?.map(id => changed.project.instances[id].childIds)).toEqual([['a'], ['b']])
  expect(changed.project.instances.a).toEqual(h.project.instances.a)
  expect(changed.project.instances.b).toEqual(h.project.instances.b)
  expect(changed.project.instances.foreign).toEqual(h.project.instances.foreign)
  expect(h.session.read().undoDepth).toBe(before.undoDepth + 1)
  expect(h.driver.load(h.driver.serialize(changed))).toEqual(changed)
  await h.undo()
  expect(h.model().project.instances).toEqual(h.project.instances)
  expect(testContainerInstance(h.model().project, h.surfaceId).childIds).toEqual(['a', 'b'])
})

it('discovers a built-in chart without an asset service and reads project entries only from granted documents', async () => {
  const h = await fixture(true), local = structuredClone(TEXT_DEFINITION)
  // A new readable document grants its own facts; the hidden registry document has no grant.
  const visibleProject = seed(), hiddenProject = seed()
  visibleProject.definitions.local = { ...local, id: 'local', title: '许可样例' }
  visibleProject.instances.a.definitionId = 'local'
  hiddenProject.definitions.hidden = { ...local, id: 'hidden', title: '未授权秘件' }
  hiddenProject.instances.a.definitionId = 'hidden'
  const visible = await h.registry.create({ kind: 'course-v10', project: visibleProject, resources: { assets: {}, components: {} } }, 'visible.glx')
  const hidden = await h.registry.create({ kind: 'course-v10', project: hiddenProject, resources: { assets: {}, components: {} } }, 'hidden.glx')
  await h.gateway.beginRun({ runId: 'read-only-discovery', actor: 'agent', documents: [{ documentId: visible.documentId, writable: [] }] })
  const call = (query: string) => h.gateway.execute('read-only-discovery', randomUUID(), { name: 'asset.search', input: { query } })
  const builtin = await call('柱形图')
  expect(builtin, JSON.stringify(builtin)).toMatchObject({ kind: 'read', data: { entries: expect.arrayContaining([expect.objectContaining({
    id: 'chart:bar', action: expect.objectContaining({ tool: 'object.insert', input: { kind: 'chart', chartType: 'bar' } }),
  })]) } })
  const visibleResult = await call('许可样例')
  expect(visibleResult, JSON.stringify(visibleResult)).toMatchObject({ kind: 'read', data: { entries: expect.arrayContaining([expect.objectContaining({ title: '许可样例' })]) } })
  const hiddenResult = await call('未授权秘件')
  expect(hiddenResult, JSON.stringify(hiddenResult)).toMatchObject({ kind: 'read', data: { entries: [] } })
  await expect(h.gateway.issueTarget('read-only-discovery', hidden.documentId, { kind: 'document' })).rejects.toThrow()
  expect(visible.read().undoDepth).toBe(0)
  expect(hidden.read().undoDepth).toBe(0)
})

it('combines caret insertion, initial appearance and click with a following mutation in one atomic batch', async () => {
  const h = await fixture(), target = await h.handle({ kind: 'course-surface', surfaceId: h.surfaceId }), at = await h.selection(2, 2)
  const neighbor = await h.handle({ kind: 'course-instance', surfaceId: h.surfaceId, instanceId: 'b' })
  const before = h.session.read()
  const result = await h.call('batch', { operations: [
    { name: 'object.insert', input: { target, at, kind: 'text', text: '新正文', appearance: { bold: true, fontSize: 28 }, click: { action: 'scene.next' } } },
    { name: 'object.update', input: { target: neighbor, properties: { label: '同批相邻对象' } } },
  ] })
  applied(result)
  const current = h.model(), inserted = current.project.instances[testContainerInstance(current.project, h.surfaceId).childIds[1]]
  expect(inserted.data).toMatchObject({ content: { inlines: [{ type: 'text', text: '新正文' }] }, appearance: { bold: true, fontSize: 28 } })
  expect(current.project.instances.b.name).toBe('同批相邻对象')
  const rules = Object.values(current.project.instances).filter(instance => componentDefinitionBuiltinKey(current.project.definitions[instance.definitionId]) === 'guoling.interactions').flatMap(interactionRules)
  expect(rules.some(rule => 'nodeId' in rule.trigger && rule.trigger.nodeId === inserted.id && rule.actions.some(step => step.action.type === 'scene.next'))).toBe(true)
  expect(h.session.read()).toMatchObject({ revision: before.revision + 1, undoDepth: before.undoDepth + 1 })
  await h.undo()
  expect(h.model().project.instances).toEqual(h.project.instances)
})
