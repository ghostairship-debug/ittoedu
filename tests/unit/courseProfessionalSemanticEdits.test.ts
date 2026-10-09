import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { componentDataEdits, componentTableDataEdits } from '../../src/core/course/componentDataEdits'
import { componentObjectJsonEdits } from '../../src/renderer/ui/DeveloperTab'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { applyComponentOperation, captureComponentOperation, presentationComponentEdits } from '../../src/core/drivers/courseV10Operations'
import { INPUT_DEFINITION, createInputData, inputDataSchema } from '../../src/components/input/data'
import { componentInputRuleEdits, inspectComponentInputRules } from '../../src/components/input/authoring'
import { interactionBehavior, interactionRules } from '../../src/shared/componentInteractionData'
import { createTableData, tableCellContent } from '../../src/components/table/data'
import { createChartData, chartDataSchema } from '../../src/components/chart/data'
import { componentDefinitionBuiltinKey, resolveComponentPresentation } from '../../src/shared/contracts/component-platform/project'
import type { ComponentEdit, CourseProjectV10, JsonValue } from '../../src/shared/contracts/component-platform'
import type { DocumentModel } from '../../src/shared/workbench/document'

const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue
const apply = (project: CourseProjectV10, edits: ComponentEdit[]) => applyComponentOperation(project, captureComponentOperation(project, edits))
const course = (model: DocumentModel) => { if (model.kind !== 'course-v10') throw new Error('V10 required'); return model.project }
function managedInput(global = false) {
  let project = createBlankCourseProjectV10('专业答案联动')
  const surfaceId = project.surfaces[0].id
  project.definitions[INPUT_DEFINITION.id] = INPUT_DEFINITION
  project.instances.input = { id: 'input', definitionId: INPUT_DEFINITION.id, data: json(createInputData()),
    frame: { width: 240, height: 50, transform: [1, 0, 0, 1, 30, 40] } }
  if (global) project.global.overlay.push('input')
  else project.surfaces[0].childIds.push('input')
  project = apply(project, componentInputRuleEdits({ project, surfaceId, instanceId: 'input' }, { mode: 'apply', config: {
    answerType: 'text', answers: ['原答案'],
    correct: [{ type: 'node.enter', nodeId: 'input', effect: 'none', durationMs: 0, easing: 'linear' }],
    error: [{ type: 'node.exit', nodeId: 'input', effect: 'none', durationMs: 0, easing: 'linear' }],
  } }))
  return { project, surfaceId }
}

it.each(['properties', 'data-file', 'component-data', 'developer', 'state', 'global'] as const)('edits managed answers through %s with one undo', async entry => {
    const fixture = managedInput(entry === 'global'), project = fixture.project, surfaceId = entry === 'global' ? null : fixture.surfaceId
    if (entry === 'state') project.surfaces[0].presentation = { states: [{ id: 'answer-state', title: '答案状态', overrides: {} }] }
    const stateId = entry === 'state' ? 'answer-state' : null
    const target = { surfaceId, instanceId: 'input', stateId }
    const before = project.instances.input, next = { ...before, data: json({ ...inputDataSchema.parse(before.data), acceptedAnswers: ['新答案'] }) }
    const edits = entry === 'developer' ? componentObjectJsonEdits(project, target, before, next)
      : componentDataEdits(project, target, entry === 'properties' ? { kind: 'patch', data: { acceptedAnswers: ['新答案'] } }
        : entry === 'data-file' ? { kind: 'fields', fields: [{ path: ['acceptedAnswers'], value: ['新答案'] }] }
          : { kind: 'replace', data: next.data })
    const session = await DocumentSession.create({ documentId: entry, epoch: entry, binding: { kind: 'untitled', suggestedName: 'input.h5lesson' },
      model: { kind: 'course-v10', project, resources: { assets: {}, components: {} } } }, new CourseV10Driver(), {
      async append() {}, async save() { throw new Error('This editing journey does not save') },
    })
    const mapped = presentationComponentEdits(project, surfaceId, stateId, edits)
    const result = await session.execute({ documentId: entry, epoch: entry, baseRevision: 0, operationId: `${entry}-edit`, actor: 'human',
      mutation: { type: 'command', command: captureComponentOperation(project, mapped) } })
    expect(result.status, entry).toBe('applied')
    const stored = course(session.read().model), effective = resolveComponentPresentation(stored, surfaceId, stateId)
    expect(inputDataSchema.parse(effective.instances.input.data).acceptedAnswers, entry).toEqual(['新答案'])
    expect(inspectComponentInputRules(effective, surfaceId, 'input').config, entry).toMatchObject({ answerType: 'text', answers: ['新答案'] })
    expect(effective.instances.input.frame).toEqual(before.frame)
    if (stateId) expect(stored.instances).toEqual(project.instances)
    const undone = await session.execute({ documentId: entry, epoch: entry, baseRevision: session.read().revision, operationId: `${entry}-undo`, actor: 'human', mutation: { type: 'undo' } })
    expect(undone.status, entry).toBe('applied')
    expect(course(session.read().model).instances, entry).toEqual(project.instances)
    expect(course(session.read().model).surfaces, entry).toEqual(project.surfaces)
})

it('preserves rich table cells and unknown custom data, while chart type changes use their professional conversion', () => {
  let project = createBlankCourseProjectV10('专业内容保全'), surfaceId = project.surfaces[0].id
  const table = createTableData({ rows: 2, columns: 2 }), cell = table.rows[0].cells[0]
  const rich = { inlines: [{ type: 'text' as const, text: '保留强调', style: { bold: true } }] }
  delete cell.text; cell.content = rich
  for (const [id, key, data] of [['table', 'guoling.table', json(table)], ['chart', 'guoling.chart', json(createChartData())],
    ['custom', 'user.custom', { nested: { arbitrary: ['keep', 3] }, flag: true }]] as const) {
    project.definitions[id] = { id, role: 'content', implementation: { kind: 'builtin', key } }
    project.instances[id] = { id, definitionId: id, data: json(data) }; project.surfaces[0].childIds.push(id)
  }
  project = apply(project, componentTableDataEdits(project, { surfaceId, instanceId: 'table' }, { kind: 'row-height', rowId: table.rows[0].id, height: 75 }))
  expect(tableCellContent((project.instances.table.data as unknown as typeof table).rows[0].cells[0])).toEqual(rich)
  project = apply(project, componentDataEdits(project, { surfaceId, instanceId: 'chart' }, { kind: 'patch', data: { chartType: 'donut' } }))
  expect(chartDataSchema.parse(project.instances.chart.data)).toMatchObject({ chartType: 'donut', style: { holeSize: 50 } })
  expect(componentDefinitionBuiltinKey(project.definitions[project.instances.chart.definitionId])).toBe('guoling.chart')
  const multiple = createChartData()
  multiple.series.push({ ...multiple.series[0], id: 'second-series', points: multiple.series[0].points.map(point => ({ ...point, id: `second-${point.id}` })) })
  project.instances.chart.data = json(multiple)
  const newPie = { chartType: 'pie', title: '新数据', categories: [{ id: 'new-category', label: '新类别' }],
    series: [{ id: 'new-series', name: '新系列', color: '#2563eb', points: [{ id: 'new-point', categoryId: 'new-category', value: 8 }] }],
    style: { backgroundColor: '#ffffff', backgroundOpacity: 1, fontFamily: 'sans-serif', fontSize: 18,
      textColor: '#172033', showLegend: true, legendPosition: 'right', showDataLabels: true } }
  const current = project.instances.chart
  project = apply(project, componentObjectJsonEdits(project, { surfaceId, instanceId: 'chart' }, current, { ...current, data: json(newPie) }))
  expect(chartDataSchema.parse(project.instances.chart.data)).toEqual(newPie)
  project = apply(project, componentDataEdits(project, { surfaceId, instanceId: 'custom' }, { kind: 'patch', data: { flag: false } }))
  expect(project.instances.custom.data).toEqual({ nested: { arbitrary: ['keep', 3] }, flag: false })
})

it('preserves hand-authored grading conflicts and applies the interaction owner lock rule to data-source edits', () => {
  const { project, surfaceId } = managedInput(), owner = { kind: 'surface' as const, surfaceId }
  const behavior = interactionBehavior(project, owner)!, rules = interactionRules(behavior)
  rules[1].actions[0].delayMs = 400
  behavior.data = json({ rules })
  expect(() => componentDataEdits(project, { surfaceId, instanceId: 'input' }, { kind: 'replace',
    data: json({ ...inputDataSchema.parse(project.instances.input.data), acceptedAnswers: ['新答案'] }) })).toThrow('手改')
  const before = structuredClone(behavior.data)
  project.instances.input.locked = true
  rules[1].name = '更改规则'
  expect(() => componentDataEdits(project, { surfaceId, instanceId: behavior.id }, { kind: 'replace', data: json({ rules }) })).toThrow('锁定')
  expect(behavior.data).toEqual(before)
})
