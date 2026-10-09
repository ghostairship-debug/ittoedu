import { z } from 'zod'

const finite = z.number().finite()
const id = z.string().min(1)
const category = z.object({ id, label: z.string() }).strict()
const point = z.object({ id, categoryId: id, value: finite }).strict()
const series = z.object({ id, name: z.string(), color: z.string(), points: z.array(point).min(1) }).strict()
/** Author table values; optional identities select already observed categories/series. */
export const chartTableDataSchema = z.object({
  categories: z.array(z.object({ id: id.optional(), label: z.string() }).strict()).min(1),
  series: z.array(z.object({ id: id.optional(), name: z.string(), color: z.string().optional(), values: z.array(finite).min(1) }).strict()).min(1),
}).strict()
const commonStyle = z.object({
  backgroundColor: z.string(), backgroundOpacity: finite.min(0).max(1),
  fontFamily: z.string().min(1), fontSize: finite.positive(), textColor: z.string(),
  showLegend: z.boolean(), legendPosition: z.enum(['top', 'right', 'bottom', 'left']), showDataLabels: z.boolean(),
}).strict()
const fields = { title: z.string(), categories: z.array(category).min(1) }
/** Professional chart data, independent of page/carrier and history. */
export const chartDataSchema = z.discriminatedUnion('chartType', [
  z.object({ ...fields, chartType: z.enum(['bar', 'line', 'area']), series: z.array(series).min(1),
    style: commonStyle.extend({ showCategoryAxis: z.boolean(), showValueAxis: z.boolean(), showGridLines: z.boolean(),
      barDirection: z.enum(['vertical', 'horizontal']).optional(), valueMin: finite.optional(), valueMax: finite.optional() }).strict() }).strict(),
  z.object({ ...fields, chartType: z.literal('pie'), series: z.tuple([series]), style: commonStyle }).strict(),
  z.object({ ...fields, chartType: z.literal('donut'), series: z.tuple([series]), style: commonStyle.extend({ holeSize: finite.min(10).max(90) }).strict() }).strict(),
]).superRefine((chart, ctx) => {
  const unique = (ids: string[], path: (string | number)[]) => {
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path, message: '图表内身份不能重复' })
  }
  unique(chart.categories.map(value => value.id), ['categories'])
  unique(chart.series.map(value => value.id), ['series'])
  unique(chart.series.flatMap(value => value.points.map(p => p.id)), ['series'])
  for (const [s, item] of chart.series.entries()) {
    if (item.points.length !== chart.categories.length || item.points.some((p, i) => p.categoryId !== chart.categories[i]?.id))
      ctx.addIssue({ code: 'custom', path: ['series', s, 'points'], message: '数据点应与分类身份和顺序对应' })
    if ((chart.chartType === 'pie' || chart.chartType === 'donut') &&
      (item.points.some(p => p.value < 0) || !item.points.some(p => p.value > 0)))
      ctx.addIssue({ code: 'custom', path: ['series', s, 'points'], message: '饼图和环形图需非负数据，且至少有一个正值' })
  }
  if ('valueMin' in chart.style && chart.style.valueMin !== undefined && chart.style.valueMax !== undefined && chart.style.valueMin >= chart.style.valueMax)
    ctx.addIssue({ code: 'custom', path: ['style', 'valueMin'], message: '坐标最小值应小于最大值' })
  if (chart.chartType !== 'bar' && 'barDirection' in chart.style && chart.style.barDirection !== undefined)
    ctx.addIssue({ code: 'custom', path: ['style', 'barDirection'], message: '横向方向仅用于条形图' })
})
export type ChartData = z.infer<typeof chartDataSchema>

export function createChartData(): ChartData {
  return { chartType: 'bar', title: '数据比较', categories: [{ id: 'a', label: '甲' }, { id: 'b', label: '乙' }],
    series: [{ id: 'series-1', name: '系列一', color: '#2563eb', points: [{ id: 'p-a', categoryId: 'a', value: 20 }, { id: 'p-b', categoryId: 'b', value: 35 }] }],
    style: { backgroundColor: '#ffffff', backgroundOpacity: 0, fontFamily: 'Noto Sans SC', fontSize: 20, textColor: '#1f2937',
      showLegend: true, legendPosition: 'bottom', showDataLabels: true, showCategoryAxis: true, showValueAxis: true, showGridLines: true } }
}
