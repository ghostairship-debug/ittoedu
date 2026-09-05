import type {
  NativeTableCell,
  NativeTableCellStyle,
  NativeTableColumn,
  NativeTableContent,
  NativeTableRow,
  NativeTableStyle,
} from './contracts/native-v1/types'

type DeepReadonlyTable<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonlyTable<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonlyTable<T[Key]> }
    : T

/** Accepts both authoring (mutable) and Published (frozen) table content. */
export type NativeTableLayoutContent = DeepReadonlyTable<NativeTableContent>

export interface NativeTableEffectiveCellStyle {
  readonly fillColor: string
  readonly fillOpacity: number
  readonly textColor: string
  readonly fontFamily: string
  readonly fontSize: number
  readonly bold: boolean
  readonly italic: boolean
  readonly horizontalAlign: 'left' | 'center' | 'right'
  readonly verticalAlign: 'top' | 'middle' | 'bottom'
  readonly borderColor: string
  readonly borderOpacity: number
  readonly borderWidth: number
  readonly lineStyle: 'solid' | 'dashed' | 'dotted'
  readonly cellPadding: number
}

export interface NativeTableLayoutCell {
  readonly id: string
  readonly rowId: string
  readonly columnId: string
  readonly rowIndex: number
  readonly columnIndex: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly text: string
  readonly isHeader: boolean
  readonly style: NativeTableEffectiveCellStyle
  readonly rawCell: DeepReadonlyTable<NativeTableCell>
}

export interface NativeTableLayoutRow {
  readonly id: string
  readonly index: number
  readonly y: number
  readonly height: number
  readonly isHeader: boolean
  readonly cells: readonly NativeTableLayoutCell[]
  readonly rawRow: DeepReadonlyTable<NativeTableRow>
}

export interface NativeTableLayoutColumn {
  readonly id: string
  readonly index: number
  readonly x: number
  readonly width: number
  readonly rawColumn: DeepReadonlyTable<NativeTableColumn>
}

export interface NativeTableLayoutGridLine {
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
}

export interface NativeTableLayout {
  readonly width: number
  readonly height: number
  readonly columns: readonly NativeTableLayoutColumn[]
  readonly rows: readonly NativeTableLayoutRow[]
  readonly cells: readonly NativeTableLayoutCell[]
  readonly headerRowCount: number
  readonly tableStyle: NativeTableStyle
  readonly verticalGridLines: readonly NativeTableLayoutGridLine[]
  readonly horizontalGridLines: readonly NativeTableLayoutGridLine[]
}

export interface BuildNativeTableLayoutOptions {
  readonly width?: number
  readonly height?: number
}

/**
 * Builds a deterministic, pure layout view model for a Native Table.
 * Scales column widths and row heights into the provided frame.
 */
export function buildNativeTableLayout(
  content: NativeTableLayoutContent,
  options: BuildNativeTableLayoutOptions = {},
): NativeTableLayout {
  const contentTotalWidth = Math.max(
    1,
    content.columns.reduce((sum, c) => sum + Math.max(1, c.width), 0),
  )
  const contentTotalHeight = Math.max(
    1,
    content.rows.reduce((sum, r) => sum + Math.max(1, r.height), 0),
  )

  const targetWidth = options.width !== undefined && options.width > 0 ? options.width : contentTotalWidth
  const targetHeight = options.height !== undefined && options.height > 0 ? options.height : contentTotalHeight

  const scaleX = targetWidth / contentTotalWidth
  const scaleY = targetHeight / contentTotalHeight

  let currentX = 0
  const columns: NativeTableLayoutColumn[] = content.columns.map((col, idx) => {
    // For the last column, absorb rounding differences to precisely reach targetWidth
    const isLast = idx === content.columns.length - 1
    const rawW = col.width * scaleX
    const colW = isLast ? Math.max(1, targetWidth - currentX) : Math.max(1, rawW)
    const colLayout: NativeTableLayoutColumn = {
      id: col.id,
      index: idx,
      x: currentX,
      width: colW,
      rawColumn: col,
    }
    currentX += colW
    return colLayout
  })

  let currentY = 0
  const allCells: NativeTableLayoutCell[] = []
  const rows: NativeTableLayoutRow[] = content.rows.map((row, rowIdx) => {
    const isLast = rowIdx === content.rows.length - 1
    const rawH = row.height * scaleY
    const rowH = isLast ? Math.max(1, targetHeight - currentY) : Math.max(1, rawH)
    const isHeader = rowIdx < content.headerRowCount

    const rowCells: NativeTableLayoutCell[] = columns.map((col, colIdx) => {
      const cell = row.cells.find((c) => c.columnId === col.id) ?? row.cells[colIdx]
      const cellStyle = cell?.style

      const effectiveStyle: NativeTableEffectiveCellStyle = {
        fillColor: cellStyle?.fillColor ?? content.style.fillColor,
        fillOpacity: cellStyle?.fillOpacity ?? content.style.fillOpacity,
        textColor: cellStyle?.textColor ?? content.style.textColor,
        fontFamily: cellStyle?.fontFamily ?? content.style.fontFamily,
        fontSize: cellStyle?.fontSize ?? content.style.fontSize,
        bold: cellStyle?.bold ?? (isHeader ? true : false),
        italic: cellStyle?.italic ?? false,
        horizontalAlign: cellStyle?.horizontalAlign ?? content.style.horizontalAlign,
        verticalAlign: cellStyle?.verticalAlign ?? content.style.verticalAlign,
        borderColor: content.style.borderColor,
        borderOpacity: content.style.borderOpacity,
        borderWidth: content.style.borderWidth,
        lineStyle: content.style.lineStyle,
        cellPadding: content.style.cellPadding,
      }

      const layoutCell: NativeTableLayoutCell = {
        id: cell?.id ?? `cell_${row.id}_${col.id}`,
        rowId: row.id,
        columnId: col.id,
        rowIndex: rowIdx,
        columnIndex: colIdx,
        x: col.x,
        y: currentY,
        width: col.width,
        height: rowH,
        text: cell?.text ?? '',
        isHeader,
        style: effectiveStyle,
        rawCell: cell ?? {
          id: `cell_${row.id}_${col.id}`,
          columnId: col.id,
          text: '',
        },
      }

      allCells.push(layoutCell)
      return layoutCell
    })

    const layoutRow: NativeTableLayoutRow = {
      id: row.id,
      index: rowIdx,
      y: currentY,
      height: rowH,
      isHeader,
      cells: rowCells,
      rawRow: row,
    }

    currentY += rowH
    return layoutRow
  })

  // Grid lines
  const verticalGridLines: NativeTableLayoutGridLine[] = []
  let vx = 0
  for (let i = 0; i <= columns.length; i++) {
    verticalGridLines.push({
      x1: vx,
      y1: 0,
      x2: vx,
      y2: targetHeight,
    })
    if (i < columns.length) {
      vx += columns[i]!.width
    }
  }

  const horizontalGridLines: NativeTableLayoutGridLine[] = []
  let hy = 0
  for (let i = 0; i <= rows.length; i++) {
    horizontalGridLines.push({
      x1: 0,
      y1: hy,
      x2: targetWidth,
      y2: hy,
    })
    if (i < rows.length) {
      hy += rows[i]!.height
    }
  }

  return {
    width: targetWidth,
    height: targetHeight,
    columns,
    rows,
    cells: allCells,
    headerRowCount: content.headerRowCount,
    tableStyle: content.style,
    verticalGridLines,
    horizontalGridLines,
  }
}
