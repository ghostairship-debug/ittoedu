import { buildNativeTableLayout, type BuildNativeTableLayoutOptions } from '../../shared/nativeTableLayout'
import { buildNativeTableSvg } from '../../shared/nativeTableSvg'
import { parseTableData, toNativeTableData, type TableData } from './data'

export function layoutTable(data: TableData, frame: BuildNativeTableLayoutOptions = {}) {
  return buildNativeTableLayout(toNativeTableData(parseTableData(data)), frame)
}

export function renderTableSvg(data: TableData, width: number, height: number, instanceId: string): string {
  return buildNativeTableSvg(toNativeTableData(parseTableData(data)), width, height, instanceId)
}
