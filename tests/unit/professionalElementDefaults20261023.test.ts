// @vitest-environment node
import { expect, it } from 'vitest'
import { chartDataSchema } from '../../src/components/chart/data'
import { parseTableData } from '../../src/components/table/data'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'
import { parseContentObjectSource, normalizeContentObjectSource } from '../../src/core/contentApply/planning/objectSource'
import { prepareProfessionalElement, professionalElementDefaultSize } from '../../src/core/course/professionalElementDefaults'
import { prepareCourseElementEdits } from '../../src/core/course/courseElementInsertion'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { planContentApply } from '../../src/main/workbench/contentApply/application/plan'
import { componentInstanceSchema } from '../../src/shared/contracts/component-platform/schema'
import { testContainerInstance } from '../helpers/glxWorkFixture'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'

function project(kind: 'slide' | 'flow' = 'slide') {
  const value = createBlankCourseProjectV10('专业插入')
  testContainerInstance(value, 0).container.kind = kind
  return value
}

it('keeps the original course, Slide and Spatial size profiles while sharing professional table defaults', () => {
  expect(professionalElementDefaultSize('table')).toEqual({ width: 600, height: 220 })
  expect(professionalElementDefaultSize('table', 'slide-authoring')).toEqual({ width: 600, height: 120 })
  expect(professionalElementDefaultSize('table', 'spatial-authoring')).toEqual({ width: 560, height: 360 })
  for (const origin of [undefined, 'slide-authoring', 'spatial-authoring'] as const) {
    const table = parseTableData(prepareProfessionalElement('table', { origin }).data)
    expect(table.rows).toHaveLength(3)
    expect(table.columns).toHaveLength(3)
    expect(table.rows.every(row => row.cells.every(cell => cell.text === ''))).toBe(true)
  }
  const p = project(), prepared = prepareCourseElementEdits(p, p.rootIds[0], null, 'chart', { origin: 'slide-authoring' })
  const changed = applyComponentOperation(p, captureComponentOperation(p, prepared.edits))
  expect(changed.instances[prepared.instanceIds[0]].frame).toEqual({ width: 560, height: 360, transform: [1, 0, 0, 1, 80, 80] })
})

it('accepts initial chart business values with software-owned categories, series and point identities', () => {
  const p = project(), prepared = prepareCourseElementEdits(p, p.rootIds[0], null, 'chart', {
    chartType: 'line', chart: { categories: [{ label: '第一天' }, { label: '第二天' }],
      series: [{ name: '温度', values: [-2, 7] }, { name: '湿度', color: '#123456', values: [20, 50] }] },
  })
  const changed = applyComponentOperation(p, captureComponentOperation(p, prepared.edits))
  const chart = chartDataSchema.parse(changed.instances[prepared.instanceIds[0]].data)
  expect(chart.chartType).toBe('line')
  expect(chart.categories.map(category => category.label)).toEqual(['第一天', '第二天'])
  expect(chart.series.map(series => series.points.map(point => point.value))).toEqual([[-2, 7], [20, 50]])
  expect(chart.series[1].color).toBe('#123456')
  expect(chart.series.every(series => series.points.every((point, index) => point.categoryId === chart.categories[index].id))).toBe(true)
})

it('uses the same chart replacement rules for a first pie chart and rejects mismatched business rows', () => {
  const chart = chartDataSchema.parse(prepareProfessionalElement('chart', { chartType: 'pie', chart: {
    categories: [{ label: '同意' }, { label: '待定' }], series: [{ name: '人数', values: [4, 1] }],
  } }).data)
  expect(chart.chartType).toBe('pie')
  expect(chart.series[0].points.map(point => point.value)).toEqual([4, 1])
  expect(() => prepareProfessionalElement('chart', { chart: {
    categories: [{ label: 'A' }], series: [{ name: '数量', values: [1, 2] }],
  } })).toThrow('数据点数量必须与分类数一致')
})

it('normalizes a built-in draft into an editable formal object in an empty work without requiring IDs or definitions', () => {
  const p: CourseProjectV10 = { ...project(), rootIds: [], definitions: {}, instances: {} }
  delete p.entry
  const source = parseContentObjectSource({ kind: 'objects', objects: [{ builtinKey: 'guoling.table' }] })
  const plan = planContentApply({ project: p, request: { intent: 'insert', target: { kind: 'container', container: { kind: 'project' } }, source }, createId: () => 'software-id' })
  const changed = applyComponentOperation(p, plan.command), instance = changed.instances['software-id']
  expect(changed.rootIds).toEqual(['software-id'])
  expect(changed.definitions[instance.definitionId].implementation).toEqual({ kind: 'builtin', key: 'guoling.table' })
  expect(parseTableData(instance.data).rows).toHaveLength(3)
  expect(instance.frame).toEqual({ width: 600, height: 220, transform: [1, 0, 0, 1, 0, 0] })
  expect(componentInstanceSchema.safeParse(instance).success).toBe(true)
  expect(p.instances).toEqual({})
})

it.each(['guoling.chart', 'guoling.table'])('keeps explicit 500×200 Flow %s frames and shares only absent size defaults', builtinKey => {
  const p = project('flow'), frame = { width: 500, height: 200, transform: [1, 0, 0, 1, 42, 33] }
  let id = 0
  const plan = planContentApply({ project: p, request: { intent: 'insert', target: { kind: 'container', container: { kind: 'instance', instanceId: p.rootIds[0] } },
    source: parseContentObjectSource({ kind: 'objects', objects: [{ builtinKey, frame }, { builtinKey }] }) }, createId: () => `new-${++id}` })
  const changed = applyComponentOperation(p, plan.command)
  expect(changed.instances['new-1'].frame).toEqual({ width: 500, height: 200, transform: [1, 0, 0, 1, 0, 0] })
  expect(changed.instances['new-2'].frame).toEqual({ ...(builtinKey === 'guoling.chart' ? { width: 520, height: 320 } : { width: 600, height: 220 }), transform: [1, 0, 0, 1, 0, 0] })
})

it('retains the established definitionId draft contract and rejects public instance bookkeeping', () => {
  const data = JSON.parse(JSON.stringify(createTextComponentData('保留现有内容')))
  const objects = [{ definitionId: TEXT_DEFINITION.id, data, frame: { width: 90, height: 40, transform: [1, 0, 0, 1, 3, 4] } }]
  expect(parseContentObjectSource({ kind: 'objects', objects }).objects).toEqual(objects)
  expect(() => parseContentObjectSource({ kind: 'objects', objects: [{ builtinKey: 'guoling.table', id: 'model-id' }] })).toThrow()
  expect(() => parseContentObjectSource({ kind: 'objects', objects: [{ definitionId: TEXT_DEFINITION.id }] })).toThrow()
  const normalized = normalizeContentObjectSource({ kind: 'objects', objects: [{ builtinKey: 'guoling.text', children: [{ builtinKey: 'guoling.formula' }] }] })
  expect(normalized.objects[0].children?.[0].definitionId).toBe('guoling.formula')
  expect(normalized.definitions?.map(definition => definition.id).sort()).toEqual(['guoling.formula', 'guoling.text'])
})
