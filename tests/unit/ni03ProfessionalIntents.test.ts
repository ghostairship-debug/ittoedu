import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { componentDataEdits, componentChartDataEdits, componentTableDataEdits } from '../../src/core/course/componentDataEdits'
import { flowPlacementEdits } from '../../src/core/course/courseFlowEdits'
import { createChartData, chartDataSchema } from '../../src/components/chart/data'
import { changeChartType } from '../../src/components/chart/contentOperations'
import { createTableData, parseTableData, tableCellContent } from '../../src/components/table/data'
import { editTableData } from '../../src/components/table/edit'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { applyComponentOperation, captureComponentOperation, presentationComponentEdits } from '../../src/core/drivers/courseV10Operations'
import type { ComponentEdit, CourseProjectV10, JsonValue } from '../../src/shared/contracts/component-platform'

const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue
const apply = (project: CourseProjectV10, edits: ComponentEdit[]) => applyComponentOperation(project, captureComponentOperation(project, edits))
function lesson() {
  const project = createBlankCourseProjectV10('普通专业数据意图')
  const chart = createChartData(), table = createTableData({ rows: 3, columns: 3 })
  const cell = table.rows[1].cells[1]
  delete cell.text
  cell.content = { inlines: [{ type: 'text', text: '保留强调', style: { bold: true } }] }
  for (const [id, data] of [['chart', chart], ['table', table]] as const) {
    project.definitions[id] = { id, role: 'content', implementation: { kind: 'builtin', key: `guoling.${id}` } }
    project.instances[id] = { id, definitionId: id, data: json(data), frame: { width: 520, height: 320, transform: [1, 0, 0, 1, 30, 40] } }
  }
  project.surfaces = [{ id: 'flow', kind: 'flow', title: '讲义', childIds: ['chart', 'table'] }]
  return { project, chart, table }
}

it('prepares ordinary chart labels/names/values and keeps retained identities through reorder and additions', () => {
  const { project, chart } = lesson()
  const next = apply(project, componentChartDataEdits(project, { surfaceId: 'flow', instanceId: 'chart' }, {
    type: 'table-data', categories: [{ label: '乙' }, { label: '甲' }, { label: '丙' }],
    series: [{ name: '系列一', values: [50, 40, 30] }, { name: '系列二', values: [6, 7, 8] }],
  }))
  const result = chartDataSchema.parse(next.instances.chart.data)
  expect(result.categories.map(value => value.id).slice(0, 2)).toEqual(['b', 'a'])
  expect(result.series[0].id).toBe(chart.series[0].id)
  expect(result.series[0].points.map(value => value.id).slice(0, 2)).toEqual(['p-b', 'p-a'])
  expect(result.series[0].points.map(value => value.value)).toEqual([50, 40, 30])
  expect(result.series[1].points.map(value => value.categoryId)).toEqual(result.categories.map(value => value.id))
  expect(result.style).toEqual(chart.style)
  expect(next.instances.chart.frame).toEqual(project.instances.chart.frame)
  expect(project.instances.chart.data).toEqual(json(chart))
})

it('moves one row or column with original rich cells, and keeps explicit full ordering and invalid-target behavior', () => {
  const { table } = lesson(), rowId = table.rows[1].id, columnId = table.columns[1].id
  const next = editTableData(editTableData(table, { kind: 'move-row', rowId, direction: 'up' }), { kind: 'move-column', columnId, direction: 'left' })
  expect(next.rows.map(row => row.id)).toEqual([rowId, table.rows[0].id, table.rows[2].id])
  expect(next.columns.map(column => column.id)).toEqual([columnId, table.columns[0].id, table.columns[2].id])
  expect(tableCellContent(next.rows[0].cells[0])).toEqual(tableCellContent(table.rows[1].cells[1]))
  expect(editTableData(next, { kind: 'move-row', rowId, direction: 'up' })).toEqual(next)
  expect(editTableData(next, { kind: 'reorder-rows', orderedRowIds: table.rows.map(row => row.id) }).rows.map(row => row.id)).toEqual(table.rows.map(row => row.id))
  expect(() => editTableData(next, { kind: 'move-column', columnId: 'missing', direction: 'left' })).toThrow('已不存在')
})

it.each(['patch', 'replace', 'fields'] as const)('prepares chart table values through the %s data-source consumer', kind => {
  const { project, chart } = lesson(), target = { surfaceId: 'flow', instanceId: 'chart' }
  const data = { categories: [{ label: '甲改名' }, { label: '乙' }], series: [{ name: '系列一', values: [9, 10] }] }
  const edits = componentDataEdits(project, target, kind === 'fields'
    ? { kind, fields: Object.entries(data).map(([name, value]) => ({ path: [name], value: json(value) })) }
    : { kind, data: json(data) })
  const next = chartDataSchema.parse(apply(project, edits).instances.chart.data)
  expect(next.categories.map(value => value.id)).toEqual(chart.categories.map(value => value.id))
  expect(next.series[0].points.map(value => value.id)).toEqual(chart.series[0].points.map(value => value.id))
  expect(next.categories[0].label).toBe('甲改名')
  expect(next.series[0].points.map(value => value.value)).toEqual([9, 10])
})

it.each(['bar-line', 'bar-pie', 'pie-line'] as const)('prepares final values and preserves observed series through %s in Session', async transition => {
  const { project, chart } = lesson()
  const second = { ...structuredClone(chart.series[0]), id: 'observed-second', name: '第二系列', color: '#ff0000',
    points: chart.series[0].points.map(point => ({ ...point, id: `second-${point.id}`, value: point.value + 1 })) }
  chart.series[0].points[0].value = -20
  chart.series.push(second)
  const before = transition === 'pie-line' ? changeChartType(chart, 'pie', second.id) : chart
  project.instances.chart.data = json(before)
  const nextSeries = transition === 'bar-line'
    ? [{ id: chart.series[0].id, name: chart.series[0].name, values: [3, 4] }, { id: second.id, name: second.name, values: [5, 6] }]
    : transition === 'bar-pie' ? [{ id: second.id, name: second.name, values: [5, 6] }]
      : [{ id: second.id, name: second.name, values: [5, 6] }, { name: '新增系列', values: [7, 8] }]
  const targetType = transition === 'bar-pie' ? 'pie' : 'line'
  const edits = componentDataEdits(project, { surfaceId: 'flow', instanceId: 'chart' }, { kind: 'patch', data: json({
    chartType: targetType, categories: before.categories.map(category => ({ id: category.id, label: category.label })), series: nextSeries,
  }) })
  const session = await DocumentSession.create({ documentId: transition, epoch: 'one', binding: { kind: 'untitled', suggestedName: 'chart.h5lesson' },
    model: { kind: 'course-v10', project, resources: { assets: {}, components: {} } } }, new CourseV10Driver(), {
      async append() {}, async save() { throw new Error('Outside this editing counterexample') },
    })
  expect((await session.execute({ documentId: transition, epoch: 'one', baseRevision: 0, operationId: 'convert', actor: 'agent',
    mutation: { type: 'command', command: captureComponentOperation(project, edits) } })).status).toBe('applied')
  const model = session.read().model
  if (model.kind !== 'course-v10') throw new Error('expected course')
  const result = chartDataSchema.parse(model.project.instances.chart.data), kept = result.series.find(series => series.id === second.id)!
  expect(result.chartType).toBe(targetType)
  expect(kept).toMatchObject({ id: second.id, name: second.name, color: second.color })
  expect(kept.points.map(point => point.id)).toEqual(second.points.map(point => point.id))
  expect(kept.points.map(point => point.value)).toEqual([5, 6])
  expect(result.series).toHaveLength(transition === 'bar-pie' ? 1 : 2)
  if (transition === 'bar-line') {
    expect(result.series[0].id).toBe(chart.series[0].id)
    expect(result.series[0].points.map(point => point.id)).toEqual(chart.series[0].points.map(point => point.id))
  }
  expect(model.project.instances.chart.frame).toEqual(project.instances.chart.frame)
  expect(session.read().undoDepth).toBe(1)
})

it('prepares established Flow defaults, explicit destination geometry, and retains nested affine geometry', () => {
  const { project } = lesson()
  delete project.instances.chart.frame
  const input = { kind: 'overlay' as const, surfaceId: 'flow', placement: { space: 'paper' as const, plane: 'overlay' as const } }
  const normal = apply(project, flowPlacementEdits(project, 'chart', input))
  expect(normal.instances.chart.frame).toEqual({ width: 240, height: 120, transform: [1, 0, 0, 1, 80, 80] })
  expect(apply(project, flowPlacementEdits(project, 'chart', { ...input, origin: 'quickbar' })).instances.chart.frame)
    .toEqual({ width: 400, height: 240, transform: [1, 0, 0, 1, 72, 72] })
  project.instances.table.childIds = ['chart']
  project.instances.table.frame = { width: 600, height: 400, transform: [2, 0, 0, 2, 100, 200] }
  project.instances.chart.frame = { width: 80, height: 40, transform: [1, 0, 0, 1, 10, 20] }
  project.surfaces[0].childIds = ['table']
  const nested = apply(project, flowPlacementEdits(project, 'chart', input))
  expect(nested.instances.chart.frame).toEqual({ width: 80, height: 40, transform: [2, 0, 0, 2, 120, 240] })
  expect(nested.instances.table.childIds).toEqual([])
  const explicit = { width: 300, height: 180, transform: [1, 0, 0, 1, 20, 30] as [number, number, number, number, number, number] }
  expect(apply(project, flowPlacementEdits(project, 'chart', { ...input, frame: explicit })).instances.chart.frame).toEqual(explicit)
})

it('submits named-state professional preparation through Session CAS/History and saves/reopens the same semantic result', async () => {
  const { project, table } = lesson()
  project.surfaces[0].kind = 'slide'
  project.surfaces[0].presentation = { states: [{ id: 'state', title: '专业数据状态', overrides: {} }] }
  const driver = new CourseV10Driver(), saved: Uint8Array[] = []
  const session = await DocumentSession.create({ documentId: 'professional', epoch: 'one', binding: { kind: 'untitled', suggestedName: 'professional.h5lesson' },
    model: { kind: 'course-v10', project, resources: { assets: {}, components: {} } } }, driver, {
    async append() {}, async save(input) { saved.push(input.bytes); return { kind: 'file', path: 'professional.h5lesson', bindingVersion: 1, version: null } },
  })
  const edits = componentTableDataEdits(project, { surfaceId: 'flow', instanceId: 'table', stateId: 'state' }, { kind: 'move-row', rowId: table.rows[1].id, direction: 'up' })
  const operation = { documentId: 'professional', epoch: 'one', baseRevision: 0, operationId: 'move', actor: 'agent' as const,
    mutation: { type: 'command' as const, command: captureComponentOperation(project, presentationComponentEdits(project, 'flow', 'state', edits)) } }
  expect((await session.execute(operation)).status).toBe('applied')
  expect(session.read().undoDepth).toBe(1)
  expect((await session.execute({ ...operation, operationId: 'stale' })).status).toBe('conflict')
  const stored = session.read().model
  if (stored.kind !== 'course-v10') throw new Error('expected course')
  expect(stored.project.instances).toEqual(project.instances)
  const override = stored.project.surfaces[0].presentation!.states[0].overrides.table
  expect(parseTableData(override.data).rows[0].id).toBe(table.rows[1].id)
  await session.save({ kind: 'file', path: 'professional.h5lesson', bindingVersion: 1, version: null })
  expect(driver.load(saved[0])).toEqual(stored)
  expect((await session.execute({ ...operation, operationId: 'undo', baseRevision: session.read().revision, actor: 'human', mutation: { type: 'undo' } })).status).toBe('applied')
  expect(session.read().model).toEqual({ kind: 'course-v10', project: { ...project, revision: session.read().revision }, resources: { assets: {}, components: {} } })
})
