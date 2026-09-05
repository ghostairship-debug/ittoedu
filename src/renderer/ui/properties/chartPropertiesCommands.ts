import type { NativeChartContent } from '../../../shared/contracts/native-v1'
import { chartNativeContentObjectSchema } from '../../../shared/contracts/native-v1'
import { changeChartType, replaceChartTableData, patchChartStyle } from '../../course/chartContentOperations'
import type { ChartPropertiesCommands } from './ChartProperties'

/** Value-only editor adapter; target/revision/history are owned by its caller. */
export function createChartPropertiesCommands(
  chart: NativeChartContent,
  commit: (next: NativeChartContent) => string | null,
  report: (reason: string) => void,
): ChartPropertiesCommands {
  const apply = (build: () => NativeChartContent): string | null => {
    try { return commit(chartNativeContentObjectSchema.parse(build())) }
    catch (error) { return error instanceof Error ? error.message : '图表数据无效' }
  }
  const run = (build: () => NativeChartContent) => { const error = apply(build); if (error) report(error) }
  return {
    patchTitle: title => run(() => ({ ...chart, title })),
    patchType: (type, series) => run(() => changeChartType(chart, type, series)),
    patchStyle: style => run(() => patchChartStyle(chart, style)),
    commitTableData: data => apply(() => replaceChartTableData(chart, data)),
  }
}
