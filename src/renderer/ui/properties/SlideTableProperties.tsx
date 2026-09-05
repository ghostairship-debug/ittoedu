import {
  useEffect,
  useRef,
  useState,
} from 'react'
import type {
  NativeTableCellStyle,
  NativeTableContent,
  NativeTableStyle,
} from '../../../shared/contracts/native-v1/types'
import { ColorInput } from '../ColorInput'
import {
  BufferedInput,
  FontFamilyPicker,
  RangeField,
  SelectField,
} from './PropertyControls'
import type { PropertiesItemBase } from './SlideNativePropertiesPanel'

export type SlideTablePropertiesView = PropertiesItemBase & {
  type: 'table'
} & NativeTableContent

export interface SlideTablePropertiesCommands {
  readonly commitCellText: (cellId: string, text: string) => void
  readonly patchStyle: (patch: Partial<NativeTableStyle>) => void
  readonly patchCellStyle: (cellId: string, patch: Partial<NativeTableCellStyle>) => void
  readonly setRowHeight: (rowId: string, height: number) => void
  readonly setColumnWidth: (columnId: string, width: number) => void
  readonly insertRow: (referenceRowId: string, position: 'before' | 'after') => void
  readonly deleteRow: (rowId: string) => void
  readonly moveRow: (rowId: string, direction: -1 | 1) => void
  readonly insertColumn: (referenceColumnId: string, position: 'before' | 'after') => void
  readonly deleteColumn: (columnId: string) => void
  readonly moveColumn: (columnId: string, direction: -1 | 1) => void
}

interface CellRef {
  readonly rowId: string
  readonly columnId: string
}

function cellKey(rowId: string, columnId: string): string {
  return `${rowId}::${columnId}`
}

function TableCellInput({
  rowId,
  columnId,
  value,
  onCommit,
  onNavigate,
  onActivate,
}: {
  rowId: string
  columnId: string
  value: string
  onCommit: (text: string) => void
  onNavigate: (from: CellRef, direction: 1 | -1) => void
  onActivate: (ref: CellRef) => void
}) {
  const [draft, setDraft] = useState(value)
  const editingRef = useRef(false)
  const composingRef = useRef(false)
  const baselineRef = useRef(value)
  const valueRef = useRef(value)
  valueRef.current = value

  useEffect(() => {
    if (!editingRef.current) {
      baselineRef.current = value
      setDraft(value)
    }
  }, [value])

  const commit = () => {
    if (!editingRef.current) return
    editingRef.current = false
    const next = draft
    baselineRef.current = next
    if (next !== valueRef.current) onCommit(next)
  }

  return (
    <input
      className="form-input table-cell-input"
      data-cell-key={cellKey(rowId, columnId)}
      aria-label={`单元格 ${rowId} / ${columnId}`}
      value={draft}
      onFocus={() => {
        editingRef.current = true
        baselineRef.current = draft
        onActivate({ rowId, columnId })
      }}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onCompositionStart={() => {
        composingRef.current = true
      }}
      onCompositionEnd={(event) => {
        composingRef.current = false
        setDraft(event.currentTarget.value)
      }}
      onBlur={() => {
        if (!editingRef.current) return
        // r12-011 write scope: a dirty cell draft must never be committed by an
        // unconfirmed blur. Enter/Tab commit; leaving the cell discards.
        editingRef.current = false
        setDraft(valueRef.current)
        baselineRef.current = valueRef.current
      }}
      onKeyDown={(event) => {
        if (composingRef.current || event.nativeEvent.isComposing) return
        if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault()
          commit()
          onNavigate({ rowId, columnId }, event.shiftKey ? -1 : 1)
        } else if (event.key === 'Escape') {
          event.preventDefault()
          editingRef.current = false
          setDraft(baselineRef.current)
          event.currentTarget.blur()
        }
      }}
    />
  )
}

export function SlideTableProperties({
  node,
  bindingKey,
  commands,
}: {
  node: SlideTablePropertiesView
  bindingKey: string
  commands: SlideTablePropertiesCommands
}) {
  const gridRef = useRef<HTMLDivElement>(null)
  const [activeCell, setActiveCell] = useState<CellRef | null>(null)
  const pendingFocusRef = useRef<{ afterRowId: string; columnId: string } | null>(null)

  const rows = node.rows
  const columns = node.columns
  const style = node.style

  // Reset only when the target node changes. The draft binding key embeds the
  // session revision, and every table command bumps it; keying this reset on
  // the full binding key would clear the active cell and the pending focus
  // restore after each committed operation.
  useEffect(() => {
    setActiveCell(null)
    pendingFocusRef.current = null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id])

  // Restore focus by stable rowId+columnId after an append-row transaction.
  useEffect(() => {
    const pending = pendingFocusRef.current
    if (!pending) return
    const rowIndex = rows.findIndex((row) => row.id === pending.afterRowId)
    const nextRow = rowIndex >= 0 ? rows[rowIndex + 1] : undefined
    if (!nextRow) return
    pendingFocusRef.current = null
    gridRef.current
      ?.querySelector<HTMLInputElement>(
        `[data-cell-key="${cellKey(nextRow.id, pending.columnId)}"]`,
      )
      ?.focus()
  }, [rows])

  const focusCell = (rowId: string, columnId: string) => {
    gridRef.current
      ?.querySelector<HTMLInputElement>(`[data-cell-key="${cellKey(rowId, columnId)}"]`)
      ?.focus()
  }

  const navigate = (from: CellRef, direction: 1 | -1) => {
    const rowIndex = rows.findIndex((row) => row.id === from.rowId)
    const columnIndex = columns.findIndex((column) => column.id === from.columnId)
    if (rowIndex < 0 || columnIndex < 0) return
    const flatIndex = rowIndex * columns.length + columnIndex + direction
    if (flatIndex < 0) {
      focusCell(rows[0]!.id, columns[0]!.id)
      return
    }
    if (flatIndex >= rows.length * columns.length) {
      // Tab past the last cell is the explicit append-row action: one history
      // transaction, then focus lands on the same column of the new row.
      const lastRow = rows[rows.length - 1]
      const firstColumnId = columns[0]?.id
      if (!lastRow || !firstColumnId) return
      pendingFocusRef.current = { afterRowId: lastRow.id, columnId: firstColumnId }
      commands.insertRow(lastRow.id, 'after')
      return
    }
    const nextRowIndex = Math.floor(flatIndex / columns.length)
    const nextColumnIndex = flatIndex % columns.length
    focusCell(rows[nextRowIndex]!.id, columns[nextColumnIndex]!.id)
  }

  const activeRow = activeCell
    ? rows.find((row) => row.id === activeCell.rowId) ?? null
    : null
  const activeColumn = activeCell
    ? columns.find((column) => column.id === activeCell.columnId) ?? null
    : null
  const activeCellData = activeRow && activeColumn && activeCell
    ? activeRow.cells.find((cell) => cell.columnId === activeCell.columnId) ?? null
    : null

  return (
    <section className="property-section" data-testid="table-properties">
      <h3 className="property-title">表格</h3>
      <div
        className="table-cell-grid"
        ref={gridRef}
        role="group"
        aria-label="表格单元格"
        style={{ display: 'grid', gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))`, gap: 4 }}
      >
        {rows.map((row) => (
          columns.map((column) => {
            const cell = row.cells.find((candidate) => candidate.columnId === column.id)
            if (!cell) return null
            return (
              <TableCellInput
                key={cell.id}
                rowId={row.id}
                columnId={column.id}
                value={cell.text}
                onCommit={(text) => commands.commitCellText(cell.id, text)}
                onNavigate={navigate}
                onActivate={setActiveCell}
              />
            )
          })
        ))}
      </div>
      <p className="property-hint">
        Enter/Tab 提交并前进，Shift+Tab 后退，Esc 或点击其它位置放弃未提交的修改；最后一个单元格再按 Tab 会在表格末尾追加一行。
      </p>

      {activeRow && activeColumn && (
        <div className="table-structure-editor" data-testid="table-structure-editor">
          <div className="property-subsection-header">
            <div>
              <strong>第 {rows.indexOf(activeRow) + 1} 行</strong>
            </div>
          </div>
          <div className="button-row">
            <button type="button" className="secondary-button" onClick={() => commands.insertRow(activeRow.id, 'before')}>上方插入行</button>
            <button type="button" className="secondary-button" onClick={() => commands.insertRow(activeRow.id, 'after')}>下方插入行</button>
          </div>
          <div className="button-row">
            <button type="button" className="secondary-button" disabled={rows.indexOf(activeRow) === 0} onClick={() => commands.moveRow(activeRow.id, -1)}>上移</button>
            <button type="button" className="secondary-button" disabled={rows.indexOf(activeRow) === rows.length - 1} onClick={() => commands.moveRow(activeRow.id, 1)}>下移</button>
            <button type="button" className="secondary-button" disabled={rows.length <= 1} onClick={() => commands.deleteRow(activeRow.id)}>删除该行</button>
          </div>
          <BufferedInput
            label="行高"
            type="number"
            min={20}
            max={2000}
            value={activeRow.height}
            onCommit={(value) => commands.setRowHeight(activeRow.id, Number(value))}
          />
          <div className="property-subsection-header">
            <div>
              <strong>第 {columns.indexOf(activeColumn) + 1} 列</strong>
            </div>
          </div>
          <div className="button-row">
            <button type="button" className="secondary-button" onClick={() => commands.insertColumn(activeColumn.id, 'before')}>左侧插入列</button>
            <button type="button" className="secondary-button" onClick={() => commands.insertColumn(activeColumn.id, 'after')}>右侧插入列</button>
          </div>
          <div className="button-row">
            <button type="button" className="secondary-button" disabled={columns.indexOf(activeColumn) === 0} onClick={() => commands.moveColumn(activeColumn.id, -1)}>左移</button>
            <button type="button" className="secondary-button" disabled={columns.indexOf(activeColumn) === columns.length - 1} onClick={() => commands.moveColumn(activeColumn.id, 1)}>右移</button>
            <button type="button" className="secondary-button" disabled={columns.length <= 1} onClick={() => commands.deleteColumn(activeColumn.id)}>删除该列</button>
          </div>
          <BufferedInput
            label="列宽"
            type="number"
            min={24}
            max={2000}
            value={activeColumn.width}
            onCommit={(value) => commands.setColumnWidth(activeColumn.id, Number(value))}
          />
        </div>
      )}

      {activeCellData && (
        <div className="table-cell-style-editor" data-testid="table-cell-style-editor">
          <div className="property-subsection-header">
            <div><strong>单元格样式覆盖</strong><small>只覆盖已设置的字段，其余继承表格样式</small></div>
          </div>
          <ColorInput
            id="table-cell-fill"
            label="单元格填充"
            value={activeCellData.style?.fillColor ?? style.fillColor}
            onChange={(fillColor) => commands.patchCellStyle(activeCellData.id, { fillColor })}
          />
          <ColorInput
            id="table-cell-text"
            label="单元格文字颜色"
            value={activeCellData.style?.textColor ?? style.textColor}
            onChange={(textColor) => commands.patchCellStyle(activeCellData.id, { textColor })}
          />
          <div className="button-row">
            <button
              type="button"
              className={`secondary-button${(activeCellData.style?.bold ?? false) ? ' secondary-button--active' : ''}`}
              onClick={() => commands.patchCellStyle(activeCellData.id, {
                bold: !(activeCellData.style?.bold ?? false),
              })}
            >
              加粗
            </button>
            <button
              type="button"
              className={`secondary-button${(activeCellData.style?.italic ?? false) ? ' secondary-button--active' : ''}`}
              onClick={() => commands.patchCellStyle(activeCellData.id, {
                italic: !(activeCellData.style?.italic ?? false),
              })}
            >
              斜体
            </button>
          </div>
        </div>
      )}

      <div className="property-subsection-header">
        <div><strong>表格样式</strong></div>
      </div>
      <ColorInput id="table-fill" label="填充颜色" value={style.fillColor} onChange={(fillColor) => commands.patchStyle({ fillColor })} />
      <RangeField
        label="填充透明度"
        value={Math.round((1 - style.fillOpacity) * 100)}
        min={0}
        max={100}
        suffix="%"
        onChange={(value) => commands.patchStyle({ fillOpacity: 1 - value / 100 })}
      />
      <ColorInput id="table-border-color" label="边框颜色" value={style.borderColor} onChange={(borderColor) => commands.patchStyle({ borderColor })} />
      <RangeField label="边框宽度" value={style.borderWidth} min={0} max={32} suffix="px" onChange={(borderWidth) => commands.patchStyle({ borderWidth })} />
      <SelectField<NativeTableStyle['lineStyle']>
        label="边框线型"
        value={style.lineStyle}
        options={[
          { value: 'solid', label: '实线' },
          { value: 'dashed', label: '虚线' },
          { value: 'dotted', label: '点线' },
        ]}
        onChange={(lineStyle) => commands.patchStyle({ lineStyle })}
      />
      <ColorInput id="table-text-color" label="文字颜色" value={style.textColor} onChange={(textColor) => commands.patchStyle({ textColor })} />
      <FontFamilyPicker value={style.fontFamily} onCommit={(fontFamily) => commands.patchStyle({ fontFamily })} />
      <BufferedInput label="字号" type="number" min={6} max={144} value={style.fontSize} onCommit={(value) => commands.patchStyle({ fontSize: Number(value) })} />
      <SelectField<NativeTableStyle['horizontalAlign']>
        label="水平对齐"
        value={style.horizontalAlign}
        options={[
          { value: 'left', label: '左对齐' },
          { value: 'center', label: '居中' },
          { value: 'right', label: '右对齐' },
        ]}
        onChange={(horizontalAlign) => commands.patchStyle({ horizontalAlign })}
      />
      <SelectField<NativeTableStyle['verticalAlign']>
        label="垂直对齐"
        value={style.verticalAlign}
        options={[
          { value: 'top', label: '顶部' },
          { value: 'middle', label: '居中' },
          { value: 'bottom', label: '底部' },
        ]}
        onChange={(verticalAlign) => commands.patchStyle({ verticalAlign })}
      />
      <RangeField label="单元格内边距" value={style.cellPadding} min={0} max={64} suffix="px" onChange={(cellPadding) => commands.patchStyle({ cellPadding })} />
    </section>
  )
}
