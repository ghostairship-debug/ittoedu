import { chartDataSchema, type ChartData } from '../../../components/chart/data'
import { changeChartType, replaceChartTableData, patchChartStyle } from '../../../components/chart/contentOperations'
import type { ChartPropertiesCommands } from './ChartProperties'

/** Value-only editor adapter; target/revision/history are owned by its caller. */
export function createChartPropertiesCommands(
  chart: ChartData,
  commit: (next: ChartData) => string | null | Promise<string | null>,
  report: (reason: string) => void,
): ChartPropertiesCommands {
  const apply = (build: () => ChartData): string | null | Promise<string | null> => {
    try { return commit(chartDataSchema.parse(build())) }
    catch (error) { return error instanceof Error ? error.message : '图表数据无效' }
  }
  const run = (build: () => ChartData) => { void Promise.resolve(apply(build)).then(error => { if (error) report(error) }, error => report(error instanceof Error ? error.message : String(error))) }
  return {
    patchTitle: title => run(() => ({ ...chart, title })),
    patchType: (type, series) => run(() => changeChartType(chart, type, series)),
    patchStyle: style => run(() => patchChartStyle(chart, style)),
    commitTableData: data => apply(() => replaceChartTableData(chart, data)),
  }
}
