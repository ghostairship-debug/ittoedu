import { TableMergeControls } from './TableMergeControls'
import type { FlowTableBlock } from '../../../shared/courseProjectTypes'
import { changeFlowTableStructure, type FlowTableStructureOperation } from '../../../core/tools/flowTableContentOperations'
import type { FlowPropertiesContext } from './FlowPropertiesPanel'

export function FlowTableProperties({ context, table }: { context: FlowPropertiesContext; table: FlowTableBlock }) {
  const change = (operation: FlowTableStructureOperation) => {
    try {
      const next = changeFlowTableStructure(table, operation)
      context.commands.patchSelectedBlock({ columns: next.columns, rows: next.rows, ...(next.merges ? { merges: next.merges } : {}) })
    } catch (error) { context.commands.reportError(error instanceof Error ? error.message : '表格修改失败') }
  }
  return <section className="property-section" data-testid="flow-table-properties">
    <h3 className="property-title">表格</h3>
    <TableMergeControls table={table} onMerge={region => change({ kind: 'merge', region })} onSplit={(rowId, columnId) => change({ kind: 'split', rowId, columnId })} />
    {!table.caption ? <button type="button" onClick={() => context.commands.patchSelectedBlock({ caption: { inlines: [] } })}>添加表格标题说明</button> : null}
    <p className="property-hint">在正文中直接编辑表头、单元格和表格标题说明；选中文字可设置格式。</p>
    {table.columns.map((column, index) => <div key={column.id}>
      <span>第 {index + 1} 列</span>
      <div className="button-row">
        <button type="button" disabled={index === 0} onClick={() => change({ kind: 'move-column', id: column.id, direction: -1 })}>左移</button>
        <button type="button" disabled={index === table.columns.length - 1} onClick={() => change({ kind: 'move-column', id: column.id, direction: 1 })}>右移</button>
        <button type="button" onClick={() => change({ kind: 'insert-column', afterId: column.id })}>右侧插入列</button>
        <button type="button" disabled={table.columns.length <= 1} onClick={() => change({ kind: 'delete-column', id: column.id })}>删除列</button>
      </div>
    </div>)}
    {table.rows.map((row, index) => <div key={row.id} className="button-row" aria-label={`第 ${index + 1} 行操作`}>
      <span>第 {index + 1} 行</span>
      <button type="button" disabled={index === 0} onClick={() => change({ kind: 'move-row', id: row.id, direction: -1 })}>上移</button>
      <button type="button" disabled={index === table.rows.length - 1} onClick={() => change({ kind: 'move-row', id: row.id, direction: 1 })}>下移</button>
      <button type="button" onClick={() => change({ kind: 'insert-row', afterId: row.id })}>下方插入行</button>
      <button type="button" onClick={() => change({ kind: 'delete-row', id: row.id })}>删除行</button>
    </div>)}
    <button type="button" onClick={() => change({ kind: 'insert-row' })}>添加行</button>
  </section>
}
