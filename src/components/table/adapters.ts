import type { ComponentDefinition, ComponentEdit, JsonValue } from '../../shared/contracts/component-platform'
import { parseTableData, type TableData } from './data'
import { editTableData, type TableEdit } from './edit'
import { outputTableHtml } from './output'
import { layoutTable } from './render'

export const TABLE_DEFINITION: ComponentDefinition = {
  id: 'guoling.table', role: 'content', title: '表格',
  implementation: { kind: 'builtin', key: 'guoling.table' },
}
export function tableDataEdit(instanceId: string, data: TableData): Extract<ComponentEdit, { type: 'data.set' }> {
  return { type: 'data.set', instanceId, path: [], value: JSON.parse(JSON.stringify(parseTableData(data))) as JsonValue }
}
export function tableEdit(instanceId: string, data: TableData, edit: TableEdit): ComponentEdit {
  return tableDataEdit(instanceId, editTableData(data, edit))
}
export const tableOutputAdapter = {
  html: outputTableHtml,
  data: (data: TableData) => parseTableData(data),
  layout: layoutTable,
}
