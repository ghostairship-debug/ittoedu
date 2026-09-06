import type { NativeChartContent } from '../../shared/contracts/native-v1'
import { chartNativeContentObjectSchema } from '../../shared/contracts/native-v1'
import { replaceChartTableData, type ChartCandidateData } from '../course/chartContentOperations'

export type ChartTextField = { readonly kind: 'title' } | {
  readonly kind: 'category' | 'series'
  readonly id: string
}

/** Serializable content owned by the active Surface edit session. */
export interface ChartTextDraft {
  readonly text: string
  readonly chart: NativeChartContent
  readonly error: string | null
}

export function readChartText(chart: NativeChartContent, field: ChartTextField): string | undefined {
  if (field.kind === 'title') return chart.title
  return field.kind === 'category'
    ? chart.categories.find(item => item.id === field.id)?.label
    : chart.series.find(item => item.id === field.id)?.name
}

export function createChartTextDraft(
  chart: NativeChartContent,
  field: ChartTextField,
  text: string,
  table?: { readonly candidate: ChartCandidateData | null; readonly error: string | null },
): ChartTextDraft {
  const source = structuredClone(chart)
  if (table?.error) return { text, chart: source, error: table.error }
  try {
    const next = table?.candidate ? replaceChartTableData(source, table.candidate) : source
    if (field.kind === 'title') next.title = text
    else if (field.kind === 'category') {
      const category = next.categories.find(item => item.id === field.id)
      if (!category) throw new Error('该分类已删除，请重新编辑。')
      category.label = text
    } else {
      const series = next.series.find(item => item.id === field.id)
      if (!series) throw new Error('该系列已删除，请重新编辑。')
      series.name = text
    }
    const parsed = chartNativeContentObjectSchema.safeParse(next)
    return parsed.success
      ? { text, chart: parsed.data, error: null }
      : { text, chart: source, error: '图表文字无效，请输入非空文字' }
  } catch (error) {
    return { text, chart: source, error: error instanceof Error ? error.message : '图表文字无效' }
  }
}
